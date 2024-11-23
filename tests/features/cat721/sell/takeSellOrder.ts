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
import { takeSellOrder } from '../../../../src/features/cat721/sell/takeSellOrder'
import { CAT721SellCovenant } from '../../../../src/covenants/cat721SellCovenant'
import { byteString2Int, hash160 } from 'scrypt-ts'
import { CAT721Sell } from '../../../../src/contracts/nft/cat721Sell'
import * as dotenv from 'dotenv'
dotenv.config()

const ECPair = ECPairFactory(ecc)
initEccLib(ecc)

const main = async function () {
    /*
    Use the order information to test takeSellOrder feature on the testnet
    */
    CAT721Sell.loadArtifact()
    const wif = process.env.PRIVATE_KEY!
    const collectionId =
        '2a69e70a240f37694bfb90c97e62ca5745b67a12a8a72bd7dd6f0ea3da0fa06a_0'
    const utxoProvider = new MempoolUtxoProvider('fractal-testnet')
    const chainProvider = new MempolChainProvider('fractal-testnet')
    const signer = new DefaultSigner(ECPair.fromWIF(wif), AddressType.P2TR)
    const collectionInfo = await getCollectionInfo(collectionId)
    const cat721Covenant = new CAT721Covenant(collectionInfo.minterAddr)
    const feeRate = 3
    const orderInfo = {
        cat721Script:
            '51206a3ae1058e2c25deb430b68d44ea644291f29ef6ea470dae62bf431d25e05ab3',
        localId: 8096n,
        recvOutput:
            '5120f5081175a9631a2453635c94de89a9cd23c5c372683a24c26329db2d05e70ff6',
        recvSatoshiBytes: '1027000000000000',
        sellerAddress: '494619d15357847eec8f1734c5d6a836f4702c63',
        txids: [
            '8a19c52d6cf66745b0d6f8c7cb7dfb7d9cb0fce5c55f4bad4c6deced0f1ac00e',
            'caf9940b32c3298d2ea4b89e1a378ddf248c5d825c4c39ba3496cd0c01fbac00',
        ],
    }
    const cat721SellCovenant = CAT721SellCovenant.createSell(
        orderInfo.recvOutput,
        cat721Covenant,
        orderInfo.localId,
        byteString2Int(orderInfo.recvSatoshiBytes),
        orderInfo.sellerAddress
    )
    const sellContractHash = hash160(cat721SellCovenant.lockingScriptHex)
    const cat721Utxos = await getCollectionAddressUtxos(
        collectionId,
        sellContractHash
    )
    if (cat721Utxos.length > 0) {
        const { guardTx, sendTx } = await takeSellOrder(
            signer,
            cat721Covenant,
            cat721SellCovenant,
            utxoProvider,
            chainProvider,
            cat721Utxos[0],
            feeRate
        )
        console.log('guardTxId:', guardTx.extractTransaction().getId())
        console.log('sendTxId:', sendTx.extractTransaction().getId())
    }
}

main()
