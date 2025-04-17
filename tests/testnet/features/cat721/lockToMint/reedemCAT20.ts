import ECPairFactory from 'ecpair'
import { initEccLib } from 'bitcoinjs-lib'
import {
    AddressType,
    CAT20Covenant,
    CAT721Covenant,
    Cat721Metadata,
    DefaultSigner,
    MempolChainProvider,
    MempoolUtxoProvider,
    OpenMinterCat20Meta,
    pickLargeFeeUtxo,
} from '@cat-protocol/cat-sdk'
import * as ecc from '@bitcoinerlab/secp256k1'
import { CatTrackerProvider } from '../../../../../src/providers/catTrackerProvider'
import { toByteString } from 'scrypt-ts'
import { LockToMintCovenant } from '../../../../../src/covenants/cat721/lockToMintCovenant'
import { redeemCAT20 } from '../../../../../src/features/cat721/lockToMint/redeemCAT20'
import { LockToMint } from '../../../../../src/contracts/cat721/lockToMint'
import { config } from 'dotenv'

config()
const ECPair = ECPairFactory(ecc)
initEccLib(ecc)

const main = async function () {
    LockToMint.loadArtifact()
    const wif = process.env.PRIVATE_KEY!
    const collectionId =
        '2a69e70a240f37694bfb90c97e62ca5745b67a12a8a72bd7dd6f0ea3da0fa06a_0'
    const tokenId =
        '8eb9257732f6a0ebe2b75fa623258c2df7435739b8d859044c8ace9cf5745dcf_0'
    const signer = new DefaultSigner(ECPair.fromWIF(wif), AddressType.P2TR)
    const utxoProvider = new MempoolUtxoProvider('fractal-testnet')
    const chainProvider = new MempolChainProvider('fractal-testnet')
    const trackerProvider = new CatTrackerProvider('fractal-testnet')
    const lockToMintInfo = {
        lockedAmount: 500n,
        lockedBlocks: 50n,
        nonce: toByteString('897147dd15b6a026a942651f01b1e9a35c4b9d43'),
    }
    const tokenInfo = await trackerProvider.tokenInfo<OpenMinterCat20Meta>(
        tokenId
    )
    const collectionInfo = await trackerProvider.collectionInfo<Cat721Metadata>(
        collectionId
    )
    const cat20Covenant = new CAT20Covenant(tokenInfo.minterAddr)
    const cat721Covenant = new CAT721Covenant(collectionInfo.minterAddr)
    const lockToMintCovenant = new LockToMintCovenant(
        cat721Covenant.lockingScriptHex,
        cat20Covenant.lockingScriptHex,
        lockToMintInfo.lockedAmount,
        lockToMintInfo.nonce,
        lockToMintInfo.lockedBlocks
    )
    const { catPsbts } = await redeemCAT20(
        signer,
        pickLargeFeeUtxo(
            await utxoProvider.getUtxos(await signer.getAddress())
        ),
        cat20Covenant,
        lockToMintCovenant,
        utxoProvider,
        chainProvider,
        1
    )
    console.log(catPsbts[1].unsignedTx.getId())
}

main()
