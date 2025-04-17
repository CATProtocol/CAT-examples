import * as dotenv from 'dotenv'
dotenv.config()
import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Ripemd160, hash160, toByteString } from 'scrypt-ts'
import {
    CAT20Covenant,
    CAT20Proto,
    CAT721Covenant,
    CAT721Proto,
    Cat20MinterUtxo,
    Cat20Utxo,
    Cat721MinterUtxo,
    Cat721Utxo,
    CatPsbt,
    NftParallelClosedMinterCat721Meta,
    NftParallelClosedMinterCovenant,
    OpenMinterCat20Meta,
    OpenMinterV2Covenant,
    OpenMinterV2Proto,
    Postage,
    addrToP2trLockingScript,
    int32,
    toTokenAddress,
} from '@cat-protocol/cat-sdk'
import {
    FEE_RATE,
    deployToken,
    mintToken,
} from '../../cat20/openMinterV2.utils'
import { verifyInputSpent } from '../../../utils/txHelper'
import { testSigner } from '../../../utils/testSigner'
import { lockToMint } from '../../../../src/features/cat721/lockToMint/lockToMint'
import {
    testChainProvider,
    testUtxoProvider,
} from '../../../utils/testProvider'
import { deployNft, mintNft } from '../nftParallelClosedMinter.utils'
import { LockToMintCovenant } from '../../../../src/covenants/cat721/lockToMintCovenant'
import { LockToMint } from '../../../../src/contracts/cat721/lockToMint'

use(chaiAsPromised)

describe('Test the features for `LockToMintCovenant`', () => {
    let address: string
    let toReceiverAddr: Ripemd160

    let tokenId: string
    let tokenAddr: string
    let minterAddr: string
    let metadata: OpenMinterCat20Meta
    let cat20Covenant: CAT20Covenant
    let cat20UtxoMoreThanLockAmount: Cat20Utxo
    let cat20UtxoEquealLockAmount: Cat20Utxo

    let collectionId: string
    let minterAddNft: string
    let metadataNft: NftParallelClosedMinterCat721Meta
    let cat721Covenant: CAT721Covenant
    let cat721Utxo: Cat721Utxo

    let lockToMintCovenant: LockToMintCovenant

    let firstMintTx: CatPsbt
    let secondMintTx: CatPsbt

    let spentMinterTx: CatPsbt

    const lockedBlocks = 17n

    before(async () => {
        LockToMint.loadArtifact()
        address = await testSigner.getAddress()
        toReceiverAddr = toTokenAddress(address)
        {
            metadata = {
                name: 'c',
                symbol: 'C',
                decimals: 2,
                max: 21000000n,
                limit: 1000n,
                premine: 3150000n,
                preminerAddr: toTokenAddress(address),
                minterMd5: OpenMinterV2Covenant.LOCKED_ASM_VERSION,
            }
            const {
                tokenId: deployedTokenId,
                tokenAddr: deployedTokenAddr,
                minterAddr: deployedMinterAddr,
                premineTx,
            } = await deployToken(metadata)
            tokenId = deployedTokenId
            tokenAddr = deployedTokenAddr
            minterAddr = deployedMinterAddr

            firstMintTx = premineTx!

            const cat20MinterUtxo: Cat20MinterUtxo = {
                utxo: {
                    txId: premineTx!.extractTransaction().getId(),
                    outputIndex: 1,
                    script: addrToP2trLockingScript(minterAddr),
                    satoshis: Postage.MINTER_POSTAGE,
                },
                txoStateHashes: premineTx!.getTxStatesInfo().txoStateHashes,
                state: OpenMinterV2Proto.create(
                    addrToP2trLockingScript(tokenAddr),
                    true,
                    8925n
                ),
            }

            const { mintTx } = await mintToken(
                cat20MinterUtxo,
                tokenId,
                metadata
            )
            secondMintTx = mintTx

            const premineTokenAmount =
                metadata.premine * 10n ** BigInt(metadata.decimals)

            cat20UtxoMoreThanLockAmount = {
                utxo: firstMintTx.getUtxo(3),
                txoStateHashes: firstMintTx.txState.stateHashList,
                state: CAT20Proto.create(premineTokenAmount, toReceiverAddr),
            }

            cat20UtxoEquealLockAmount = {
                utxo: secondMintTx.getUtxo(3),
                txoStateHashes: secondMintTx.txState.stateHashList,
                state: CAT20Proto.create(
                    metadata.limit * 10n ** BigInt(metadata.decimals),
                    toReceiverAddr
                ),
            }
        }

        {
            metadataNft = {
                name: 'Locked-up Cats',
                symbol: 'LCAT',
                max: 10000n,
                minterMd5: NftParallelClosedMinterCovenant.LOCKED_ASM_VERSION,
                description:
                    'It’s the first NFT collection distributed on the Bitcoin Network based on the brand new CAT721 protocol.',
            }

            const {
                revealTx,
                collectionId: deployedCollectionId,
                minterAddr: deployedNftMinterAddr,
            } = await deployNft(metadataNft)

            collectionId = deployedCollectionId
            minterAddNft = deployedNftMinterAddr
            spentMinterTx = revealTx
        }

        cat20Covenant = new CAT20Covenant(minterAddr)

        cat721Covenant = new CAT721Covenant(minterAddNft)

        lockToMintCovenant = new LockToMintCovenant(
            cat721Covenant.lockingScriptHex,
            cat20Covenant.lockingScriptHex,
            cat20UtxoEquealLockAmount.state.amount,
            hash160(toByteString('')),
            lockedBlocks
        )

        {
            //
            const inputMinter = NftParallelClosedMinterCovenant.fromMintTx(
                collectionId,
                toReceiverAddr,
                metadataNft,
                spentMinterTx.extractTransaction().toHex(),
                1
            )
            const minterOutputIndex = 1
            const tx = spentMinterTx.extractTransaction()
            const cat721MinterUtxo: Cat721MinterUtxo = {
                utxo: {
                    txId: tx.getId(),
                    outputIndex: minterOutputIndex,
                    satoshis: Number(tx.outs[minterOutputIndex].value),
                    script: Buffer.from(
                        tx.outs[minterOutputIndex].script
                    ).toString('hex'),
                },
                txoStateHashes: spentMinterTx.txState.stateHashList,
                state: inputMinter.state!,
            }
            const { mintTx } = await mintNft(
                cat721MinterUtxo,
                collectionId,
                metadataNft,
                hash160(lockToMintCovenant.lockingScriptHex)
            )

            cat721Utxo = {
                utxo: mintTx.getUtxo(3),
                txoStateHashes: mintTx.txState.stateHashList,
                state: CAT721Proto.create(
                    hash160(lockToMintCovenant.lockingScriptHex),
                    0n
                ),
            }
        }
    })

    describe('When lockToMint', () => {
        it('should success lock to mint no token change', async () => {
            const { lockToMintTx } = await lockToMint(
                testSigner,
                cat20Covenant,
                cat721Covenant,
                await testSigner.getAddress(),
                lockToMintCovenant,
                testUtxoProvider,
                testChainProvider,
                cat721Utxo,
                cat20UtxoEquealLockAmount,
                FEE_RATE,
                await testSigner.getAddress(),
                10000
            )
            for (let index = 0; index < lockToMintTx.inputCount; index++) {
                expect(verifyInputSpent(lockToMintTx, index)).to.be.true
            }
        })

        it('should success lock to mint have token change', async () => {
            const { lockToMintTx } = await lockToMint(
                testSigner,
                cat20Covenant,
                cat721Covenant,
                await testSigner.getAddress(),
                lockToMintCovenant,
                testUtxoProvider,
                testChainProvider,
                cat721Utxo,
                cat20UtxoMoreThanLockAmount,
                FEE_RATE,
                await testSigner.getAddress(),
                10000
            )
            for (let index = 0; index < lockToMintTx.inputCount; index++) {
                expect(verifyInputSpent(lockToMintTx, index)).to.be.true
            }
        })
    })
})
