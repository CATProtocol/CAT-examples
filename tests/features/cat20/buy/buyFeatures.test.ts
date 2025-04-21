import * as dotenv from 'dotenv'
dotenv.config()
import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { testSigner } from '../../../utils/testSigner'
import { createCAT20BuyOrder } from '../../../../src/features/cat20/buy/createBuyOrder'
import { cancelCAT20BuyOrder } from '../../../../src/features/cat20/buy/cancelBuyOrder'
import { takeCAT20BuyOrder } from '../../../../src/features/cat20/buy/takeBuyOrder'
import {
    testChainProvider,
    testUtxoProvider,
} from '../../../utils/testProvider'
import { CAT20BuyCovenant } from '../../../../src/covenants/cat20/cat20BuyCovenant'
import { bvmVerify, Int32 } from '@scrypt-inc/scrypt-ts-btc'
import {
    OpenMinterCat20Meta,
    CAT20Covenant,
    CAT20Utxo,
} from '@cat-protocol/cat-sdk-v2'
import { TestCAT20Generater } from '../../../utils/testCAT20Generater'
import { loadAllArtifacts } from '../utils'

use(chaiAsPromised)

describe('Test the features for `CAT20BuyCovenant`', () => {
    let address: string
    let metadata: OpenMinterCat20Meta
    let cat20Covenant: CAT20Covenant
    let cat20UtxoTwo: CAT20Utxo[]
    let cat20Generater: TestCAT20Generater

    before(async () => {
        loadAllArtifacts()
        address = await testSigner.getAddress()
        metadata = {
            name: 'c',
            symbol: 'C',
            decimals: 2,
            max: 21000000n,
            limit: 1000n,
            premine: 3150000n,
            minterMd5: '',
        }
        cat20Generater = await TestCAT20Generater.init(metadata)
        cat20Covenant = new CAT20Covenant(cat20Generater.deployInfo.minterAddr)
        cat20UtxoTwo = [
            await cat20Generater.mintTokenToAddr(address, 1000000n),
            await cat20Generater.mintTokenToAddr(address, 1000000n),
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
        buyAmount: Int32,
        price: Int32,
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
            1
        )
        expect(bvmVerify(sendTx, 0)).to.be.true
    }

    async function testCancelBuyOrderResult(
        buyAmount: Int32,
        price: Int32,
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
            1
        )
        // expect(verifyInputSpent(sendTx, 0)).to.be.true
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
            1
        )
        expect(bvmVerify(cancelTx, 0)).to.be.true
    }

    async function testTakeBuyOrderAllResult(
        buyAmount: Int32,
        price: Int32,
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
            1
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
            1
        )
        // verify sell contract take unlock
        expect(bvmVerify(takeSendTx, 0)).to.be.true
        // verify token input unlock
        expect(bvmVerify(takeSendTx, 1)).to.be.true
        // verify guard input unlock
        expect(bvmVerify(takeSendTx, 2)).to.be.true
    }

    async function testTakeBuyOrderPartialResult(
        buyAmount: Int32,
        price: Int32,
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
            1
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
            1
        )
        // verify sell contract take unlock
        expect(bvmVerify(takeSendTx1, 0)).to.be.true
        // verify token input unlock
        expect(bvmVerify(takeSendTx1, 1)).to.be.true
        // verify guard input unlock
        expect(bvmVerify(takeSendTx1, 2)).to.be.true
        const cat20BuyCovenant2 = new CAT20BuyCovenant(
            orderInfo.cat20Script,
            orderInfo.buyerAddress,
            orderInfo.price,
            orderInfo.scalePrice
        )
        cat20BuyCovenant2.bindToUtxo(takeSendTx1.getUtxo(3))
        const { sendTx: takeSendTx2 } = await takeCAT20BuyOrder(
            testSigner,
            cat20Covenant,
            cat20UtxoTwo,
            cat20BuyCovenant2,
            testUtxoProvider,
            testChainProvider,
            takeChange,
            {
                script: '',
                satoshis: '0000000000000000',
            },
            1
        )
        // verify sell contract take unlock
        expect(bvmVerify(takeSendTx2, 0)).to.be.true
        // verify token input unlock
        expect(bvmVerify(takeSendTx2, 1)).to.be.true
        // verify guard input unlock
        expect(bvmVerify(takeSendTx2, 2)).to.be.true
    }
})
