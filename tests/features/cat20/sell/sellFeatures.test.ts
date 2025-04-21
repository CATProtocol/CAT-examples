import * as dotenv from 'dotenv'
dotenv.config()
import { expect, use } from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { testSigner } from '../../../utils/testSigner'
import { createCAT20SellOrder } from '../../../../src/features/cat20/sell/createSellOrder'
import { cancelCAT20SellOrder } from '../../../../src/features/cat20/sell/cancelSellOrder'
import {
    testChainProvider,
    testUtxoProvider,
} from '../../../utils/testProvider'
import { CAT20SellCovenant } from '../../../../src/covenants/cat20/cat20SellCovenant'
import {
    OpenMinterCat20Meta,
    CAT20Covenant,
    CAT20Utxo,
} from '@cat-protocol/cat-sdk-v2'
import { TestCAT20Generater } from '../../../utils/testCAT20Generater'
import { loadAllArtifacts } from '../utils'
import { bvmVerify, Int32 } from '@scrypt-inc/scrypt-ts-btc'
import { takeCAT20SellOrder } from '../../../../src/features/cat20/sell/takeSellOrder'

use(chaiAsPromised)

describe('Test the features for `CAT20SellCovenant`', () => {
    let address: string
    let metadata: OpenMinterCat20Meta
    let cat20Covenant: CAT20Covenant
    let cat20UtxoSingle: CAT20Utxo[]
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

        cat20UtxoSingle = [
            await cat20Generater.mintTokenToAddr(address, 1000000n),
        ]

        cat20UtxoTwo = [
            // first token utxo
            await cat20Generater.mintTokenToAddr(address, 1000000n),
            // second token utxo
            await cat20Generater.mintTokenToAddr(address, 1000000n),
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
        cat20Utxos: CAT20Utxo[],
        sellAmount: Int32,
        price: Int32,
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
            1
        )
        // check guard tx
        expect(guardTx).not.to.be.undefined
        expect(guardTx.isFinalized).to.be.true
        // check send tx
        expect(sendTx).not.to.be.undefined
        expect(sendTx.isFinalized).to.be.true
        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(bvmVerify(sendTx, i)).to.be.true
        }
        // verify guard input unlock
        expect(bvmVerify(sendTx, cat20Utxos.length)).to.be.true
    }

    async function testCancelSellOrderResult(
        cat20Utxos: CAT20Utxo[],
        sellAmount: Int32,
        price: Int32,
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
            1
        )
        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(bvmVerify(sendTx, i)).to.be.true
        }
        // verify guard input unlock
        expect(bvmVerify(sendTx, cat20Utxos.length)).to.be.true
        const sellCAT20Utxo = {
            ...sendTx.getUtxo(1),
            txoStateHashes: sendTx.getTxoStateHashes(),
            state: {
                ownerAddr: orderInfo.sellContractAddress,
                amount: sellAmount,
            },
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
            1
        )
        // verify sell contract cancel unlock
        expect(bvmVerify(cancelSendTx, 0)).to.be.true
        // verify token input unlock
        expect(bvmVerify(cancelSendTx, 1)).to.be.true
        // verify guard input unlock
        expect(bvmVerify(cancelSendTx, 2)).to.be.true
    }

    async function testTakeSellOrderAllResult(
        cat20Utxos: CAT20Utxo[],
        sellAmount: Int32,
        price: Int32,
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
            1
        )
        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(bvmVerify(sendTx, i)).to.be.true
        }
        // verify guard input unlock
        expect(bvmVerify(sendTx, cat20Utxos.length)).to.be.true
        const sellCAT20Utxo = {
            ...sendTx.getUtxo(1),
            txoStateHashes: sendTx.getTxoStateHashes(),
            state: {
                ownerAddr: orderInfo.sellContractAddress,
                amount: sellAmount,
            },
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
            1
        )
        // verify sell contract take unlock
        expect(bvmVerify(takeSendTx, 0)).to.be.true
        // verify token input unlock
        expect(bvmVerify(takeSendTx, 1)).to.be.true
        // verify guard input unlock
        expect(bvmVerify(takeSendTx, 2)).to.be.true
    }

    async function testTakeSellOrderPartialResult(
        cat20Utxos: CAT20Utxo[],
        sellAmount: Int32,
        price: Int32,
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
            1
        )
        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(bvmVerify(sendTx, i)).to.be.true
        }
        // verify guard input unlock
        expect(bvmVerify(sendTx, cat20Utxos.length)).to.be.true
        const sellCAT20Utxo = {
            ...sendTx.getUtxo(1),
            txoStateHashes: sendTx.getTxoStateHashes(),
            state: {
                ownerAddr: orderInfo.sellContractAddress,
                amount: sellAmount,
            },
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
            1
        )
        // verify sell contract take unlock
        expect(bvmVerify(takeSendTx1, 0)).to.be.true
        // verify token input unlock
        expect(bvmVerify(takeSendTx1, 1)).to.be.true
        // verify guard input unlock
        expect(bvmVerify(takeSendTx1, 2)).to.be.true
        const sellCAT20UtxoTakeChange = {
            ...takeSendTx1.getUtxo(2),
            txoStateHashes: takeSendTx1.getTxoStateHashes(),
            state: {
                amount: takeChange,
                ownerAddr: orderInfo.sellContractAddress,
            },
        }
        const cat20SellCovenant2 = new CAT20SellCovenant(
            orderInfo.cat20Script,
            orderInfo.recvOutput,
            orderInfo.sellerAddress,
            orderInfo.price,
            orderInfo.scalePrice
        )
        const { sendTx: takeSendTx2 } = await takeCAT20SellOrder(
            testSigner,
            cat20Covenant,
            cat20SellCovenant2,
            testUtxoProvider,
            testChainProvider,
            sellCAT20UtxoTakeChange,
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
