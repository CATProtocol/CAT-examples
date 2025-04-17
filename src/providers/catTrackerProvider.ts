import {
    Cat20Metadata,
    Cat20TokenInfo,
    Cat20Utxo,
    Cat721Metadata,
    Cat721NftInfo,
    SupportedNetwork,
} from '@cat-protocol/cat-sdk'
import axios, { AxiosInstance } from 'axios'
import { TrackerProvider } from '../lib/provider'

export class CatTrackerProvider implements TrackerProvider {
    private client: AxiosInstance

    constructor(network: SupportedNetwork, customBaseUrl?: string) {
        let baseUrl = 'https://tracker-fractal-mainnet.catprotocol.org'
        if (network === 'fractal-testnet') {
            baseUrl = 'https://tracker-fractal-testnet.catprotocol.org'
        }
        this.client = axios.create({
            baseURL: customBaseUrl || baseUrl,
        })
    }

    async tokenInfo<T extends Cat20Metadata>(
        tokenId: string
    ): Promise<Cat20TokenInfo<T>> {
        const path = `/api/tokens/${tokenId}`
        const info = (await this.client.get(path)).data.data
        info.metadata = info.info
        return info
    }

    async collectionInfo<T extends Cat721Metadata>(
        collectionId: string
    ): Promise<Cat721NftInfo<T>> {
        const path = `/api/collections/${collectionId}`
        const info = (await this.client.get(path)).data.data
        info.metadata = info.info
        return info
    }

    async tokens(
        tokenId: string,
        ownerAddr: string,
        limit: number = 20
    ): Promise<Cat20Utxo[]> {
        const path = `/api/tokens/${tokenId}/addresses/${ownerAddr}/utxos?limit=${limit}`
        const data = (await this.client.get(path)).data.data
        const { utxos } = data
        const cat20Utxos: Array<Cat20Utxo> = utxos.map((utxoData) => {
            if (typeof utxoData.utxo.satoshis === 'string') {
                utxoData.utxo.satoshis = parseInt(utxoData.utxo.satoshis)
            }

            const cat20Utxo: Cat20Utxo = {
                utxo: utxoData.utxo,
                txoStateHashes: utxoData.txoStateHashes,
                state: {
                    ownerAddr: utxoData.state.address,
                    amount: BigInt(utxoData.state.amount),
                },
            }

            return cat20Utxo
        })
        return cat20Utxos
    }
}
