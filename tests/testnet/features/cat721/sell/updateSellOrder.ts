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
import { updateSellOrder } from '../../../../../src/features/cat721/sell/updateSellOrder'
import { CAT721SellCovenant } from '../../../../../src/covenants/cat721/cat721SellCovenant'
import { byteString2Int, hash160 } from 'scrypt-ts'
import { CAT721Sell } from '../../../../../src/contracts/cat721/cat721Sell'
import * as dotenv from 'dotenv'
dotenv.config()

const ECPair = ECPairFactory(ecc)
initEccLib(ecc)

const main = async function () {
    /*
    Use the order information to test updateSellOrder feature on the testnet
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
    const cat721PriceNew = 20000n
    const feeRate = 3
    const orderInfo = {
        cat721Script:
            '51206a3ae1058e2c25deb430b68d44ea644291f29ef6ea470dae62bf431d25e05ab3',
        localId: 8093n,
        recvOutput:
            '5120f5081175a9631a2453635c94de89a9cd23c5c372683a24c26329db2d05e70ff6',
        recvSatoshiBytes: '1027000000000000',
        sellerAddress: '494619d15357847eec8f1734c5d6a836f4702c63',
        txids: [
            '20203f00fe7128a984f48a7973d67d0b23e8a6789d6768139cf6267701fc6274',
            'a0f16de4e9dfc928caa0bd34f34b719a5b2d3c6d4095f2ac5926c69ab898c21d',
        ],
    }
    const cat721SellCovenant = CAT721SellCovenant.createSell(
        orderInfo.recvOutput,
        cat721Covenant,
        orderInfo.localId,
        byteString2Int(orderInfo.recvSatoshiBytes),
        orderInfo.sellerAddress
    )
    const cat721SellCovenantNew = CAT721SellCovenant.createSell(
        orderInfo.recvOutput,
        cat721Covenant,
        orderInfo.localId,
        cat721PriceNew,
        orderInfo.sellerAddress
    )
    const sellContractHash = hash160(cat721SellCovenant.lockingScriptHex)
    const sellContractHashNew = hash160(cat721SellCovenantNew.lockingScriptHex)
    const cat721Utxos = await getCollectionAddressUtxos(
        collectionId,
        sellContractHash
    )
    const subContract = cat721SellCovenantNew.getSubContract() as CAT721Sell
    if (cat721Utxos.length > 0) {
        const { guardTx, sendTx } = await updateSellOrder(
            signer,
            cat721Covenant,
            cat721SellCovenant,
            utxoProvider,
            chainProvider,
            cat721Utxos[0],
            sellContractHashNew,
            feeRate
        )
        const orderInfo = {
            cat721Script: subContract.cat721Script,
            localId: subContract.localId,
            recvOutput: subContract.recvOutput,
            recvSatoshiBytes: subContract.recvSatoshiBytes,
            sellerAddress: subContract.sellerAddress,
            txids: [
                guardTx.extractTransaction().getId(),
                sendTx.extractTransaction().getId(),
            ],
        }
        console.log(orderInfo)
    }
}

main()
