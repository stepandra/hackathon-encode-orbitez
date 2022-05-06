import * as errors from '../infra/errors';
import axios from 'axios';

export interface DigitalOceanDropletSpecification {
  installCommand: string;
  size: string;
  image: string;
  tags: string[];
}

// See definition and example at
// https://developers.digitalocean.com/documentation/v2/#retrieve-an-existing-droplet-by-id
export type DropletInfo = Readonly<{
  id: number;
  status: 'new' | 'active';
  tags: string[];
  region: {readonly slug: string};
  size: Readonly<{
    transfer: number;
    price_monthly: number;
  }>;
  networks: Readonly<{
    v4: ReadonlyArray<
      Readonly<{
        type: string;
        ip_address: string;
      }>
    >;
  }>;
}>;

// Reference:
// https://developers.digitalocean.com/documentation/v2/#get-user-information
export type Account = Readonly<{
  email: string;
  uuid: string;
  email_verified: boolean;
  status: string;
}>;

// Reference:
// https://developers.digitalocean.com/documentation/v2/#regions
export type RegionInfo = Readonly<{
  slug: string;
  name: string;
  sizes: string[];
  available: boolean;
  features: string[];
}>;

// Marker class for errors due to network or authentication.
// See below for more details on when this is raised.
export class XhrError extends errors.OutlineError {
  constructor() {
    // No message because XMLHttpRequest.onerror provides no useful info.
    super();
  }
}

// This class contains methods to interact with DigitalOcean on behalf of a user.
export interface DigitalOceanSession {
  accessToken: string;
  getAccount(): Promise<Account>;
  createDroplet(
    displayName: string,
    region: string,
    publicKeyForSSH: string,
    dropletSpec: DigitalOceanDropletSpecification
  ): Promise<{droplet: DropletInfo}>;
  deleteDroplet(dropletId: number): Promise<void>;
  getRegionInfo(): Promise<RegionInfo[]>;
  getDroplet(dropletId: number): Promise<DropletInfo>;
  getDropletTags(dropletId: number): Promise<string[]>;
  getDropletsByTag(tag: string): Promise<DropletInfo[]>;
  getDroplets(): Promise<DropletInfo[]>;
}

export class RestApiSession implements DigitalOceanSession {
  // Constructor takes a DigitalOcean access token, which should have
  // read+write permissions.
  constructor(public accessToken: string) {}

  public getAccount(): Promise<Account> {
    console.info('Requesting account');
    return this.request<{account: Account}>('GET', 'account').then((response) => {
      return response.account;
    });
  }

  public createDroplet(
    displayName: string,
    region: string,
    publicKeyForSSH: string,
    dropletSpec: DigitalOceanDropletSpecification
  ): Promise<{droplet: DropletInfo}> {
    const dropletName = makeValidDropletName(displayName);
    // Register a key with DigitalOcean, so the user will not get a potentially
    // confusing email with their droplet password, which could get mistaken for
    // an invite.
    console.log("PUBLICK KEY", publicKeyForSSH)
    return this.registerKey_(dropletName, publicKeyForSSH).then((keyId: number) => {
      return this.makeCreateDropletRequest(dropletName, region, keyId, dropletSpec);
    });
  }

  private makeCreateDropletRequest(
    dropletName: string,
    region: string,
    keyId: number,
    dropletSpec: DigitalOceanDropletSpecification
  ): Promise<{droplet: DropletInfo}> {
    let requestCount = 0;
    const MAX_REQUESTS = 10;
    const RETRY_TIMEOUT_MS = 5000;
    return new Promise((fulfill, reject) => {
      const makeRequestRecursive = () => {
        ++requestCount;
        console.info(`Requesting droplet creation ${requestCount}/${MAX_REQUESTS}`);
        this.request<{droplet: DropletInfo}>('POST', 'droplets', {
          name: dropletName,
          region,
          size: dropletSpec.size,
          image: dropletSpec.image,
          ssh_keys: [keyId],
          user_data: dropletSpec.installCommand,
          tags: dropletSpec.tags,
          ipv6: true,
        })
          .then(fulfill)
          .catch((e) => {
            if (e.message.toLowerCase().indexOf('finalizing') >= 0 && requestCount < MAX_REQUESTS) {
              // DigitalOcean is still validating this account and may take
              // up to 30 seconds.  We can retry more frequently to see when
              // this error goes away.
              setTimeout(makeRequestRecursive, RETRY_TIMEOUT_MS);
            } else {
              reject(e);
            }
          });
      };
      makeRequestRecursive();
    });
  }

  public deleteDroplet(dropletId: number): Promise<void> {
    console.info('Requesting droplet deletion');
    return this.request<void>('DELETE', 'droplets/' + dropletId);
  }

  public getRegionInfo(): Promise<RegionInfo[]> {
    console.info('Requesting region info');
    return this.request<{regions: RegionInfo[]}>('GET', 'regions').then((response) => {
      return response.regions;
    });
  }

  // Registers a SSH key with DigitalOcean.
  private registerKey_(keyName: string, publicKeyForSSH: string): Promise<number> {
    console.info('Requesting key registration');
    return this.request<{ssh_key: {id: number}}>('POST', 'account/keys', {
      name: keyName,
      public_key: publicKeyForSSH,
    }).then((response) => {
      return response.ssh_key.id;
    });
  }

  public getDroplet(dropletId: number): Promise<DropletInfo> {
    console.info('Requesting droplet');
    return this.request<{droplet: DropletInfo}>('GET', 'droplets/' + dropletId).then((response) => {
      return response.droplet;
    });
  }

  public getDropletTags(dropletId: number): Promise<string[]> {
    return this.getDroplet(dropletId).then((droplet: DropletInfo) => {
      return droplet.tags;
    });
  }

  public getDropletsByTag(tag: string): Promise<DropletInfo[]> {
    console.info('Requesting droplet by tag');
    return this.request<{droplets: DropletInfo[]}>(
      'GET',
      `droplets?tag_name=${encodeURI(tag)}`
    ).then((response) => {
      return response.droplets;
    });
  }

  public getDroplets(): Promise<DropletInfo[]> {
    console.info('Requesting droplets');
    return this.request<{droplets: DropletInfo[]}>('GET', 'droplets').then((response) => {
      return response.droplets;
    });
  }

  // Makes an XHR request to DigitalOcean's API, returns a promise which fulfills
  // with the parsed object if successful.
  private request<T>(method: string, actionPath: string, data?: {}): Promise<T> {
    return new Promise<T>(async (resolve, reject) => {
      const url = `https://api.digitalocean.com/v2/${actionPath}`;
      try {
        let response = await axios({
          method,
          url,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          data
        })

        if (response.status >= 200 && response.status <= 299) {
            // Parse JSON response if available.  For requests like DELETE
            // this.response may be empty.
            console.log(response.data)
            const responseObj = response.data ? response.data : {};
            resolve(responseObj);
          } else if (response.status === 401) {
            console.error('DigitalOcean request failed with Unauthorized error');
            reject(new XhrError());
          } else {
            // this.response is a JSON object, whose message is an error string.
            const responseJson = response.data;
            console.error(`DigitalOcean request failed with status ${response.status}`);
            reject(
              new Error(`XHR ${responseJson.id} failed with ${response.status}: ${responseJson.message}`)
            );
          }
        } catch (e) {
          console.log(e)
        }
    });
  }
}

// Removes invalid characters from input name so it can be used with
// DigitalOcean APIs.
function makeValidDropletName(name: string): string {
  // Remove all characters outside of A-Z, a-z, 0-9 and '-'.
  return name.replace(/[^A-Za-z0-9-]/g, '');
}
