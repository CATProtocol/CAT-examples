import {
    AddressType,
    CAT721Covenant,
    DefaultSigner,
    MempolChainProvider,
    MempoolUtxoProvider,
} from '@cat-protocol/cat-sdk'
import * as ecc from '@bitcoinerlab/secp256k1'
import ECPairFactory from 'ecpair'
import { initEccLib } from 'bitcoinjs-lib'
import { getCollectionAddressUtxos, getCollectionInfo } from './apis'
import { createSellOrder } from '../../../../../src/features/cat721/sell/createSellOrder'
import { CAT721Sell } from '../../../../../src/contracts/cat721/cat721Sell'
import * as dotenv from 'dotenv'
dotenv.config()

const ECPair = ECPairFactory(ecc)
initEccLib(ecc)

const main = async function () {
    /*
    Test the createSellOrder feature of the CAT721 contract on the testnet. 
    First, constructor CAT721Sell contract with appropriate arguments. Then, transfer
    the CAT721 token to the sell contract, and finally, return the order information.
    */
    CAT721Sell.loadArtifact()
    const wif = process.env.PRIVATE_KEY!
    const collectionId =
        '2a69e70a240f37694bfb90c97e62ca5745b67a12a8a72bd7dd6f0ea3da0fa06a_0'
    const utxoProvider = new MempoolUtxoProvider('fractal-testnet')
    const chainProvider = new MempolChainProvider('fractal-testnet')
    const signer = new DefaultSigner(ECPair.fromWIF(wif), AddressType.P2TR)
    const address = await signer.getAddress()
    const cat721Utxos = await getCollectionAddressUtxos(collectionId, address)
    if (cat721Utxos.length == 0) {
        console.log(
            `This address(${address}) does not own any NFTs from this collection(${collectionId}), \
            modify the variable collectionId to match the collection of the NFTs held by this address.`
        )
        return
    }
    const collectionInfo = await getCollectionInfo(collectionId)
    const cat721Covenant = new CAT721Covenant(collectionInfo.minterAddr)
    const sell721Utxo = cat721Utxos[0]
    const cat721Price = 10000n
    const feeRate = 3
    const { orderInfo } = await createSellOrder(
        signer,
        cat721Covenant,
        utxoProvider,
        chainProvider,
        sell721Utxo,
        cat721Price,
        feeRate
    )
    console.log(orderInfo)
}

main()
