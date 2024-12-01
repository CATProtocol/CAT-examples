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
import { CAT20Buy } from '../../../../src/contracts/cat20/cat20Buy'
import { createCAT20BuyOrder } from '../../../../src/features/cat20/buy/createBuyOrder'
import { cancelCAT20BuyOrder } from '../../../../src/features/cat20/buy/cancelBuyOrder'
import { takeCAT20BuyOrder } from '../../../../src/features/cat20/buy/takeBuyOrder'
import {
    testChainProvider,
    testUtxoProvider,
} from '../../../utils/testProvider'
import { CAT20BuyCovenant } from '../../../../src/covenants/cat20/cat20BuyCovenant'

use(chaiAsPromised)

describe('Test the features for `CAT20BuyCovenant`', () => {
    let address: string
    let toReceiverAddr: Ripemd160

    let tokenId: string
    let tokenAddr: string
    let minterAddr: string
    let metadata: OpenMinterCat20Meta
    let cat20Covenant: CAT20Covenant
    let cat20UtxoTwo: Cat20Utxo[]

    let firstMintTx: CatPsbt
    let secondMintTx: CatPsbt

    before(async () => {
        CAT20Buy.loadArtifact()
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

    describe('When createCAT20BuyOrder', () => {
        it('should buy successfully', async () => {
            const buyAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testCreateBuyOrderResult(buyAmount, price, scalePrice)
        })

        it('should buy successfully with scalePrice equal true', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = true
            await testCreateBuyOrderResult(sellAmount, price, scalePrice)
        })
    })

    describe('When takeCAT20BuyOrder', () => {
        it('should buy all token successfully', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testTakeBuyOrderAllResult(sellAmount, price, scalePrice)
        })
        it('should buy all token successfully with scalePrice equal true', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = true
            await testTakeBuyOrderAllResult(sellAmount, price, scalePrice)
        })
        it('should buy partial token successfully', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testTakeBuyOrderPartialResult(sellAmount, price, scalePrice)
        })
        it('should take partial token successfully with scalePrice equal true', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = true
            await testTakeBuyOrderPartialResult(sellAmount, price, scalePrice)
        })
    })

    describe('When cancelCAT20BuyOrder', () => {
        it('should transfer satoshi back to user successfully', async () => {
            const sellAmount = 1000n * 10n ** BigInt(metadata.decimals)
            const price = 10n
            const scalePrice = false
            await testCancelBuyOrderResult(sellAmount, price, scalePrice)
        })
    })

    async function testCreateBuyOrderResult(
        buyAmount: int32,
        price: int32,
        scalePrice: boolean
    ) {
        const { sendTx } = await createCAT20BuyOrder(
            testSigner,
            cat20Covenant,
            testUtxoProvider,
            testChainProvider,
            buyAmount,
            price,
            scalePrice,
            FEE_RATE
        )
        expect(verifyInputSpent(sendTx, 0)).to.be.true
    }

    async function testCancelBuyOrderResult(
        buyAmount: int32,
        price: int32,
        scalePrice: boolean
    ) {
        const { sendTx, orderInfo } = await createCAT20BuyOrder(
            testSigner,
            cat20Covenant,
            testUtxoProvider,
            testChainProvider,
            buyAmount,
            price,
            scalePrice,
            FEE_RATE
        )
        expect(verifyInputSpent(sendTx, 0)).to.be.true
        const cat20BuyCovenant = new CAT20BuyCovenant(
            orderInfo.cat20Script,
            orderInfo.buyerAddress,
            orderInfo.price,
            orderInfo.scalePrice
        )
        cat20BuyCovenant.bindToUtxo(sendTx.getUtxo(1))
        const { cancelTx } = await cancelCAT20BuyOrder(
            testSigner,
            cat20BuyCovenant,
            testChainProvider,
            FEE_RATE
        )
        expect(verifyInputSpent(cancelTx, 0)).to.be.true
    }

    async function testTakeBuyOrderAllResult(
        buyAmount: int32,
        price: int32,
        scalePrice: boolean
    ) {
        const { sendTx, orderInfo } = await createCAT20BuyOrder(
            testSigner,
            cat20Covenant,
            testUtxoProvider,
            testChainProvider,
            buyAmount,
            price,
            scalePrice,
            FEE_RATE
        )
        const cat20BuyCovenant = new CAT20BuyCovenant(
            orderInfo.cat20Script,
            orderInfo.buyerAddress,
            orderInfo.price,
            orderInfo.scalePrice
        )
        cat20BuyCovenant.bindToUtxo(sendTx.getUtxo(1))
        const { sendTx: takeSendTx } = await takeCAT20BuyOrder(
            testSigner,
            cat20Covenant,
            cat20UtxoTwo,
            cat20BuyCovenant,
            testUtxoProvider,
            testChainProvider,
            buyAmount,
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

    async function testTakeBuyOrderPartialResult(
        buyAmount: int32,
        price: int32,
        scalePrice: boolean
    ) {
        const { sendTx, orderInfo } = await createCAT20BuyOrder(
            testSigner,
            cat20Covenant,
            testUtxoProvider,
            testChainProvider,
            buyAmount,
            price,
            scalePrice,
            FEE_RATE
        )
        const cat20BuyCovenant = new CAT20BuyCovenant(
            orderInfo.cat20Script,
            orderInfo.buyerAddress,
            orderInfo.price,
            orderInfo.scalePrice
        )
        cat20BuyCovenant.bindToUtxo(sendTx.getUtxo(1))
        const firstTakeAmount = buyAmount / 10n
        const takeChange = buyAmount - firstTakeAmount
        const { sendTx: takeSendTx1 } = await takeCAT20BuyOrder(
            testSigner,
            cat20Covenant,
            cat20UtxoTwo,
            cat20BuyCovenant,
            testUtxoProvider,
            testChainProvider,
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
        cat20BuyCovenant.bindToUtxo(takeSendTx1.getUtxo(3))
        const { sendTx: takeSendTx2 } = await takeCAT20BuyOrder(
            testSigner,
            cat20Covenant,
            cat20UtxoTwo,
            cat20BuyCovenant,
            testUtxoProvider,
            testChainProvider,
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
