import { DigitalOceanAccount } from './digitalocean_account' 
import { Region } from './model/digitalocean';


const TOKEN = ''
const REGION = 'nyc3'

async function main() {
  const doAccount = new DigitalOceanAccount('do_account', TOKEN, true)
  doAccount.createServer(new Region(REGION), 'ORBITEZ_TEZ_NODE');
}

main().catch((e) => {
  console.log(e)
})