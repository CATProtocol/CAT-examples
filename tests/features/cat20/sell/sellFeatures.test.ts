import * as dotenv from 'dotenv'
dotenv.config()
import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Ripemd160 } from 'scrypt-ts'
import {
    CAT20Covenant,
    CAT20Proto,
    Cat20MinterUtxo,
    Cat20Utxo,
    CatPsbt,
    OpenMinterCat20Meta,
    OpenMinterV2Covenant,
    OpenMinterV2Proto,
    Postage,
    addrToP2trLockingScript,
    int32,
    toTokenAddress,
} from '@cat-protocol/cat-sdk'
import { FEE_RATE, deployToken, mintToken } from '../openMinterV2.utils'
import { verifyInputSpent } from '../../../utils/txHelper'
import { testSigner } from '../../../utils/testSigner'
import { CAT20Sell } from '../../../../src/contracts/cat20/cat20Sell'
import { createCAT20SellOrder } from '../../../../src/features/cat20/sell/createSellOrder'
import { cancelCAT20SellOrder } from '../../../../src/features/cat20/sell/cancelSellOrder'
import { takeCAT20SellOrder } from '../../../../src/features/cat20/sell/takeSellOrder'
import {
    testChainProvider,
    testUtxoProvider,
} from '../../../utils/testProvider'
import { CAT20SellCovenant } from '../../../../src/covenants/cat20/cat20SellCovenant'

use(chaiAsPromised)

describe('Test the features for `CAT20SellCovenant`', () => {
    let address: string
    let toReceiverAddr: Ripemd160

    let tokenId: string
    let tokenAddr: string
    let minterAddr: string
    let metadata: OpenMinterCat20Meta
    let cat20Covenant: CAT20Covenant
    let cat20UtxoSingle: Cat20Utxo[]
    let cat20UtxoTwo: Cat20Utxo[]

    let firstMintTx: CatPsbt
    let secondMintTx: CatPsbt

    before(async () => {
        CAT20Sell.loadArtifact()
        address = await testSigner.getAddress()
        toReceiverAddr = toTokenAddress(address)
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

        const { mintTx } = await mintToken(cat20MinterUtxo, tokenId, metadata)

        secondMintTx = mintTx

        cat20Covenant = new CAT20Covenant(minterAddr)

        const premineTokenAmount =
            metadata.premine * 10n ** BigInt(metadata.decimals)

        cat20UtxoSingle = [
            {
                utxo: firstMintTx.getUtxo(3),
                txoStateHashes: firstMintTx.txState.stateHashList,
                state: CAT20Proto.create(premineTokenAmount, toReceiverAddr),
            },
        ]

        cat20UtxoTwo = [
            // first token utxo
            {
                utxo: firstMintTx.getUtxo(3),
                txoStateHashes: firstMintTx.txState.stateHashList,
                state: CAT20Proto.create(premineTokenAmount, toReceiverAddr),
            },
            // second token utxo
            {
                utxo: secondMintTx.getUtxo(3),
                txoStateHashes: secondMintTx.txState.stateHashList,
                state: CAT20Proto.create(
                    metadata.limit * 10n ** BigInt(metadata.decimals),
                    toReceiverAddr
                ),
            },
        ]
    })

    describe('When createCAT20SellOrder', () => {
        it('should sell one token utxo successfully', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testCreateSellOrderResult(
                cat20UtxoSingle,
                sellAmount,
                price,
                scalePrice
            )
        })

        it('should sell multiple token utxos successfully', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testCreateSellOrderResult(
                cat20UtxoTwo,
                sellAmount,
                price,
                scalePrice
            )
        })

        it('should sell one token utxo successfully with scalePrice equal true', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = true
            await testCreateSellOrderResult(
                cat20UtxoSingle,
                sellAmount,
                price,
                scalePrice
            )
        })

        it('should sell multiple token utxos successfully with scalePrice equal true', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = true
            await testCreateSellOrderResult(
                cat20UtxoTwo,
                sellAmount,
                price,
                scalePrice
            )
        })
    })

    describe('When takeCAT20SellOrder', () => {
        it('should take all token successfully', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testTakeSellOrderAllResult(
                cat20UtxoSingle,
                sellAmount,
                price,
                scalePrice
            )
        })
        it('should take all token successfully with scalePrice equal true', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = true
            await testTakeSellOrderAllResult(
                cat20UtxoSingle,
                sellAmount,
                price,
                scalePrice
            )
        })
        it('should take partial token successfully', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testTakeSellOrderPartialResult(
                cat20UtxoSingle,
                sellAmount,
                price,
                scalePrice
            )
        })
        it('should take partial token successfully with scalePrice equal true', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = true
            await testTakeSellOrderPartialResult(
                cat20UtxoSingle,
                sellAmount,
                price,
                scalePrice
            )
        })
    })

    describe('When cancelCAT20SellOrder', () => {
        it('should transfer token back to user successfully', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testCancelSellOrderResult(
                cat20UtxoSingle,
                sellAmount,
                price,
                scalePrice
            )
        })
    })

    async function testCreateSellOrderResult(
        cat20Utxos: Cat20Utxo[],
        sellAmount: int32,
        price: int32,
        scalePrice: boolean
    ) {
        const { guardTx, sendTx } = await createCAT20SellOrder(
            testSigner,
            cat20Covenant,
            testUtxoProvider,
            testChainProvider,
            cat20Utxos,
            sellAmount,
            price,
            scalePrice,
            FEE_RATE
        )
        // check guard tx
        expect(guardTx).not.to.be.undefined
        expect(guardTx.isFinalized).to.be.true
        // check send tx
        expect(sendTx).not.to.be.undefined
        expect(sendTx.isFinalized).to.be.true
        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(verifyInputSpent(sendTx, i)).to.be.true
        }
        // verify guard input unlock
        expect(verifyInputSpent(sendTx, cat20Utxos.length)).to.be.true
    }

    async function testCancelSellOrderResult(
        cat20Utxos: Cat20Utxo[],
        sellAmount: int32,
        price: int32,
        scalePrice: boolean
    ) {
        const { sendTx, orderInfo } = await createCAT20SellOrder(
            testSigner,
            cat20Covenant,
            testUtxoProvider,
            testChainProvider,
            cat20Utxos,
            sellAmount,
            price,
            scalePrice,
            FEE_RATE
        )
        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(verifyInputSpent(sendTx, i)).to.be.true
        }
        // verify guard input unlock
        expect(verifyInputSpent(sendTx, cat20Utxos.length)).to.be.true
        const sellCAT20Utxo = {
            utxo: sendTx.getUtxo(1),
            txoStateHashes: sendTx.txState.stateHashList,
            state: CAT20Proto.create(sellAmount, orderInfo.sellContractAddress),
        }
        const cat20SellCovenant = new CAT20SellCovenant(
            orderInfo.cat20Script,
            orderInfo.recvOutput,
            orderInfo.sellerAddress,
            orderInfo.price,
            orderInfo.scalePrice
        )
        const { sendTx: cancelSendTx } = await cancelCAT20SellOrder(
            testSigner,
            cat20Covenant,
            cat20SellCovenant,
            testUtxoProvider,
            testChainProvider,
            sellCAT20Utxo,
            FEE_RATE
        )
        // verify sell contract cancel unlock
        expect(verifyInputSpent(cancelSendTx, 0)).to.be.true
        // verify token input unlock
        expect(verifyInputSpent(cancelSendTx, 1)).to.be.true
        // verify guard input unlock
        expect(verifyInputSpent(cancelSendTx, 2)).to.be.true
    }

    async function testTakeSellOrderAllResult(
        cat20Utxos: Cat20Utxo[],
        sellAmount: int32,
        price: int32,
        scalePrice: boolean
    ) {
        const { sendTx, orderInfo } = await createCAT20SellOrder(
            testSigner,
            cat20Covenant,
            testUtxoProvider,
            testChainProvider,
            cat20Utxos,
            sellAmount,
            price,
            scalePrice,
            FEE_RATE
        )
        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(verifyInputSpent(sendTx, i)).to.be.true
        }
        // verify guard input unlock
        expect(verifyInputSpent(sendTx, cat20Utxos.length)).to.be.true
        const sellCAT20Utxo = {
            utxo: sendTx.getUtxo(1),
            txoStateHashes: sendTx.txState.stateHashList,
            state: CAT20Proto.create(sellAmount, orderInfo.sellContractAddress),
        }
        const cat20SellCovenant = new CAT20SellCovenant(
            orderInfo.cat20Script,
            orderInfo.recvOutput,
            orderInfo.sellerAddress,
            orderInfo.price,
            orderInfo.scalePrice
        )
        const { sendTx: takeSendTx } = await takeCAT20SellOrder(
            testSigner,
            cat20Covenant,
            cat20SellCovenant,
            testUtxoProvider,
            testChainProvider,
            sellCAT20Utxo,
            sellAmount,
            {
                script: '',
                satoshis: '0000000000000000',
            },
            FEE_RATE
        )
        // verify sell contract take unlock
        expect(verifyInputSpent(takeSendTx, 0)).to.be.true
        // verify token input unlock
        expect(verifyInputSpent(takeSendTx, 1)).to.be.true
        // verify guard input unlock
        expect(verifyInputSpent(takeSendTx, 2)).to.be.true
    }

    async function testTakeSellOrderPartialResult(
        cat20Utxos: Cat20Utxo[],
        sellAmount: int32,
        price: int32,
        scalePrice: boolean
    ) {
        const { sendTx, orderInfo } = await createCAT20SellOrder(
            testSigner,
            cat20Covenant,
            testUtxoProvider,
            testChainProvider,
            cat20Utxos,
            sellAmount,
            price,
            scalePrice,
            FEE_RATE
        )
        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(verifyInputSpent(sendTx, i)).to.be.true
        }
        // verify guard input unlock
        expect(verifyInputSpent(sendTx, cat20Utxos.length)).to.be.true
        const sellCAT20Utxo = {
            utxo: sendTx.getUtxo(1),
            txoStateHashes: sendTx.txState.stateHashList,
            state: CAT20Proto.create(sellAmount, orderInfo.sellContractAddress),
        }
        const cat20SellCovenant = new CAT20SellCovenant(
            orderInfo.cat20Script,
            orderInfo.recvOutput,
            orderInfo.sellerAddress,
            orderInfo.price,
            orderInfo.scalePrice
        )
        const firstTakeAmount = sellAmount / 10n
        const takeChange = sellAmount - firstTakeAmount
        const { sendTx: takeSendTx1 } = await takeCAT20SellOrder(
            testSigner,
            cat20Covenant,
            cat20SellCovenant,
            testUtxoProvider,
            testChainProvider,
            sellCAT20Utxo,
            firstTakeAmount,
            {
                script: '',
                satoshis: '0000000000000000',
            },
            FEE_RATE
        )
        // verify sell contract take unlock
        expect(verifyInputSpent(takeSendTx1, 0)).to.be.true
        // verify token input unlock
        expect(verifyInputSpent(takeSendTx1, 1)).to.be.true
        // verify guard input unlock
        expect(verifyInputSpent(takeSendTx1, 2)).to.be.true
        const sellCAT20UtxoTakeChange = {
            utxo: takeSendTx1.getUtxo(2),
            txoStateHashes: takeSendTx1.txState.stateHashList,
            state: CAT20Proto.create(takeChange, orderInfo.sellContractAddress),
        }
        const { sendTx: takeSendTx2 } = await takeCAT20SellOrder(
            testSigner,
            cat20Covenant,
            cat20SellCovenant,
            testUtxoProvider,
            testChainProvider,
            sellCAT20UtxoTakeChange,
            takeChange,
            {
                script: '',
                satoshis: '0000000000000000',
            },
            FEE_RATE
        )
        // verify sell contract take unlock
        expect(verifyInputSpent(takeSendTx2, 0)).to.be.true
        // verify token input unlock
        expect(verifyInputSpent(takeSendTx2, 1)).to.be.true
        // verify guard input unlock
        expect(verifyInputSpent(takeSendTx2, 2)).to.be.true
    }
})
