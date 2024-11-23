import { Cat721Utxo, btc } from '@cat-protocol/cat-sdk'
import axios from 'axios'
import mempoolJS from '@mempool/mempool.js'

const trackerClient = axios.create({
    baseURL: 'https://tracker-fractal-testnet.catprotocol.org',
})

export const { bitcoin } = mempoolJS({
    hostname: 'mempool-testnet.fractalbitcoin.io',
    network: 'mainnet',
})

export interface CollectionInfo {
    minterAddr: string
    revealTxid: string
    revealHeight: number
    genesisTxid: string
    name: string
    symbol: string
    minterPubKey: string
    firstMintHeight: number
    collectionId: string
    collectionAddr: string
    collectionPubKey: string
}

export const getCollectionInfo = async (
    collectionId: string
): Promise<CollectionInfo> => {
    const path = `/api/collections/${collectionId}`
    return (await trackerClient.get(path)).data.data
}

export const getCollectionAddressUtxos = async (
    collectionId: string,
    ownerAddrOrPkh: string,
    limit: number = 10
): Promise<Cat721Utxo[]> => {
    const path = `/api/collections/${collectionId}/addresses/${ownerAddrOrPkh}/utxos?limit=${limit}`
    const data = (await trackerClient.get(path)).data.data
    const { utxos } = data
    utxos.forEach((element) => {
        element.state = {
            ownerAddr: element.state.address,
            localId: BigInt(element.state.localId),
        }
    })
    return utxos
}

export const getUtxos = async function (addressString: string) {
    const script = new btc.Script(new btc.Address(addressString))
    const utxos = await bitcoin.addresses.getAddressTxsUtxo({
        address: addressString,
    })
    return utxos.map((value) => {
        return {
            address: addressString,
            txId: value.txid,
            outputIndex: value.vout,
            script: script,
            satoshis: value.value,
        }
    })
}

export async function broadcastTx(txHex: string) {
    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://mempool-testnet.fractalbitcoin.io/api/tx',
        headers: {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7',
            'content-type': 'text/plain',
        },
        data: txHex,
    }
    return (await axios.request(config)).data
}
