import * as dotenv from 'dotenv'
dotenv.config()

import { expect, use } from 'chai'

import chaiAsPromised from 'chai-as-promised'
import { hash160 } from 'scrypt-ts'
import { getOutpointString } from '@cat-protocol/cat-smartcontracts'
import { CAT20Proto, CAT20State } from '@cat-protocol/cat-smartcontracts'
import { CAT20 } from '@cat-protocol/cat-smartcontracts'
import { ClosedMinter } from '@cat-protocol/cat-smartcontracts'
import { CAT20Sell } from '../src/contracts/cat20Sell'
import { BuyCAT20 } from '../src/contracts/buyCAT20'

import { UTXO, getBtcDummyUtxo, getDummyGenesisTx } from './utils/txHelper'

import { KeyInfo, getKeyInfoFromWif, getPrivKey } from './utils/privateKey'
import {
    closedMinterCall,
    closedMinterDeploy,
    getGuardContractInfo,
} from './cat20'
import {
    ContractIns,
    TaprootMastSmartContract,
    TaprootSmartContract,
} from '@cat-protocol/cat-smartcontracts/dist/lib/catTx'
import { btc } from '@cat-protocol/cat-smartcontracts/dist/lib/btc'
import { cat20SellCall } from './cat20Sell'
import { buycat20Call } from './buyCAT20'

use(chaiAsPromised)

describe('Test `CAT20` tokens', () => {
    let keyInfo: KeyInfo
    let genesisTx: btc.Transaction
    let genesisUtxo: UTXO
    let genesisOutpoint: string
    let closedMinter: ClosedMinter
    let closedMinterTaproot: TaprootSmartContract
    let guardInfo: TaprootMastSmartContract
    let token: CAT20
    let tokenTaproot: TaprootSmartContract
    let closedMinterIns: ContractIns<string>
    let cat20Sell: CAT20Sell
    let cat20SellScale: CAT20Sell
    let buycat20: BuyCAT20
    let buycat20Scale: BuyCAT20
    let cat20SellTaproot: TaprootSmartContract
    let cat20SellScaleTaproot: TaprootSmartContract
    let buycat20Taproot: TaprootSmartContract
    let buycat20ScaleTaproot: TaprootSmartContract
    let keyLocking: string
    let feeDeployUtxo
    const price = 100000n

    before(async () => {
        // init load
        CAT20Sell.loadArtifact()
        BuyCAT20.loadArtifact()
        // key info
        keyInfo = getKeyInfoFromWif(getPrivKey())
        // dummy genesis
        const dummyGenesis = getDummyGenesisTx(keyInfo.seckey, keyInfo.addr)
        genesisTx = dummyGenesis.genesisTx
        genesisUtxo = dummyGenesis.genesisUtxo
        genesisOutpoint = getOutpointString(genesisTx, 0)
        // minter
        closedMinter = new ClosedMinter(keyInfo.xAddress, genesisOutpoint)
        closedMinterTaproot = TaprootSmartContract.create(closedMinter)
        // guard
        guardInfo = getGuardContractInfo()
        // token
        token = new CAT20(
            closedMinterTaproot.lockingScriptHex,
            guardInfo.lockingScriptHex
        )
        tokenTaproot = TaprootSmartContract.create(token)
        // deploy minter
        closedMinterIns = await closedMinterDeploy(
            keyInfo.seckey,
            genesisUtxo,
            closedMinter,
            tokenTaproot.lockingScriptHex
        )
        keyLocking = genesisTx.outputs[0].script.toHex()
        cat20Sell = new CAT20Sell(
            tokenTaproot.lockingScriptHex,
            keyLocking,
            keyInfo.xAddress,
            price,
            false
        )

        cat20SellScale = new CAT20Sell(
            tokenTaproot.lockingScriptHex,
            keyLocking,
            keyInfo.xAddress,
            price,
            true
        )

        buycat20 = new BuyCAT20(
            tokenTaproot.lockingScriptHex,
            keyInfo.xAddress,
            price,
            false
        )

        buycat20Scale = new BuyCAT20(
            tokenTaproot.lockingScriptHex,
            keyInfo.xAddress,
            price,
            true
        )

        cat20SellTaproot = TaprootSmartContract.create(cat20Sell)
        cat20SellScaleTaproot = TaprootSmartContract.create(cat20SellScale)
        buycat20Taproot = TaprootSmartContract.create(buycat20)
        buycat20ScaleTaproot = TaprootSmartContract.create(buycat20Scale)
        feeDeployUtxo = getBtcDummyUtxo(keyInfo.addr)
    })

    async function mintToken(tokenState: CAT20State) {
        const closedMinterCallInfo = await closedMinterCall(
            closedMinterIns,
            tokenTaproot,
            tokenState,
            true
        )
        closedMinterIns = closedMinterCallInfo.nexts[0] as ContractIns<string>
        return closedMinterCallInfo.nexts[1] as ContractIns<CAT20State>
    }

    async function getTokenByNumber(
        count: number,
        xAddress: string,
        amount?: bigint
    ): Promise<ContractIns<CAT20State>[]> {
        const inputTokens: ContractIns<CAT20State>[] = []
        for (let i = 0; i < count; i++) {
            let mintAmount = BigInt(Math.floor(Math.random() * 100)) + 10n
            if (typeof amount === 'bigint') {
                mintAmount = amount
            }
            inputTokens.push(
                await mintToken(CAT20Proto.create(mintAmount, xAddress))
            )
        }
        return inputTokens
    }

    describe('When a token is being sell', () => {
        it('t01: should success sell all', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                0n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t02: should success sell all with multi input tokens', async () => {
            const inputTokens = await getTokenByNumber(
                2,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                0n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t03: should success sell partial', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                1n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price
            )
            expect(nextTokens.length).to.be.equal(2)
        })

        it('t04: should success sell partial with multi token input', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                1n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price
            )
            expect(nextTokens.length).to.be.equal(2)
        })

        it('t05: should success sell partial multiple until sell out', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellTaproot.lockingScriptHex)
            )
            const totalAmount = inputTokens[0].state.amount
            const sellMultiple = async function (
                inputTokens: ContractIns<CAT20State>[],
                amount: bigint
            ) {
                const nextTokens = await cat20SellCall(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    amount - 1n,
                    keyInfo.xAddress,
                    inputTokens,
                    cat20SellTaproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price
                )
                if (nextTokens.length == 2) {
                    await sellMultiple([nextTokens[1]], amount - 1n)
                }
            }
            await sellMultiple(inputTokens, totalAmount)
        })
    })

    describe('When a token is being sell, scale = true', () => {
        it('t01: should success sell all', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellScaleTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                0n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                true
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t01: should success sell all, satoshis <= 549755813887 (2^39 -1)', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellScaleTaproot.lockingScriptHex),
                21474n
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                0n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                true
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t01: should fail sell all, satoshis > 549755813887 (2^39 -1)', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellScaleTaproot.lockingScriptHex),
                21475n
            )
            await expect(
                cat20SellCall(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    0n,
                    keyInfo.xAddress,
                    inputTokens,
                    cat20SellScaleTaproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price,
                    true
                )
            ).to.be.rejectedWith(/expected false to equal true/)
        })

        it('t02: should success sell all with multi input tokens', async () => {
            const inputTokens = await getTokenByNumber(
                2,
                hash160(cat20SellScaleTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                0n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                true
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t03: should success sell partial', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellScaleTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                1n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                true
            )
            expect(nextTokens.length).to.be.equal(2)
        })

        it('t04: should success sell partial with multi token input', async () => {
            const inputTokens = await getTokenByNumber(
                2,
                hash160(cat20SellScaleTaproot.lockingScriptHex)
            )
            const nextTokens = await cat20SellCall(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                10n,
                keyInfo.xAddress,
                inputTokens,
                cat20SellScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                true
            )
            expect(nextTokens.length).to.be.equal(2)
        })

        it('t05: should success sell partial multiple until sell out', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(cat20SellScaleTaproot.lockingScriptHex)
            )
            const totalAmount = inputTokens[0].state.amount
            const sellMultiple = async function (
                inputTokens: ContractIns<CAT20State>[],
                amount: bigint
            ) {
                const nextTokens = await cat20SellCall(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    amount - 1n,
                    keyInfo.xAddress,
                    inputTokens,
                    cat20SellScaleTaproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price,
                    true
                )
                if (nextTokens.length == 2) {
                    await sellMultiple([nextTokens[1]], amount - 1n)
                }
            }
            await sellMultiple(inputTokens, totalAmount)
        })
    })

    describe('buy token', () => {
        it('t01: should success sell to buyer partially', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20Taproot.lockingScriptHex)
            )

            const preferBuyAmount = 1n
            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                1n,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20Taproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preferBuyAmount
            )
            expect(nextTokens.length).to.be.equal(2)
        })

        it('t02: should success sell to buyer all', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20Taproot.lockingScriptHex)
            )

            const preferBuyAmount = inputTokens[0].state.amount
            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                preferBuyAmount,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20Taproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preferBuyAmount
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t03: should success sell to buyer all with 3 token utxos', async () => {
            const inputTokens = await getTokenByNumber(
                3,
                hash160(buycat20Taproot.lockingScriptHex)
            )

            const preferBuyAmount = inputTokens.reduce(
                (acc, inputToken) => acc + inputToken.state.amount,
                0n
            )

            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                preferBuyAmount,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20Taproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preferBuyAmount
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t04: should fail if too much satoshis to seller', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20Taproot.lockingScriptHex)
            )

            const preferBuyAmount = 10n
            const toBuyerAmount = 1n

            await expect(
                buycat20Call(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    toBuyerAmount,
                    keyInfo.xAddress,
                    keyInfo.xAddress,
                    inputTokens,
                    buycat20Taproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price,
                    preferBuyAmount,
                    false,
                    toBuyerAmount * price + 100n
                )
            ).to.be.rejectedWith(/expected false to equal true/)
        })
    })

    describe('buy token, scale = true', () => {
        it('t01: should success sell to buyer partially', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20ScaleTaproot.lockingScriptHex)
            )

            const preRemainingAmount = 1n
            const preferBuyAmount = preRemainingAmount

            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                preferBuyAmount,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20ScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preRemainingAmount,
                true
            )
            expect(nextTokens.length).to.be.equal(2)
        })

        it('t02: should success sell to buyer all', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20ScaleTaproot.lockingScriptHex)
            )

            const preRemainingAmount = inputTokens[0].state.amount
            const preferBuyAmount = preRemainingAmount
            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                preferBuyAmount,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20ScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preRemainingAmount,
                true
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t03: should success sell to buyer all with 3 token utxos', async () => {
            const inputTokens = await getTokenByNumber(
                3,
                hash160(buycat20ScaleTaproot.lockingScriptHex)
            )

            const preRemainingAmount = inputTokens.reduce(
                (acc, inputToken) => acc + inputToken.state.amount,
                0n
            )

            const preferBuyAmount = preRemainingAmount

            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                preferBuyAmount,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20ScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preRemainingAmount,
                true
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t04: should success with satoshis <= 549755813887 (2^39 -1)', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20ScaleTaproot.lockingScriptHex),
                21474n
            )

            const preRemainingAmount = inputTokens.reduce(
                (acc, inputToken) => acc + inputToken.state.amount,
                0n
            )
            const preferBuyAmount = preRemainingAmount

            const nextTokens = await buycat20Call(
                feeDeployUtxo,
                keyInfo.seckey,
                keyLocking,
                preferBuyAmount,
                keyInfo.xAddress,
                keyInfo.xAddress,
                inputTokens,
                buycat20ScaleTaproot,
                closedMinterTaproot.lockingScriptHex,
                guardInfo,
                price,
                preRemainingAmount,
                true
            )
            expect(nextTokens.length).to.be.equal(1)
        })

        it('t04: should fail with satoshis > 549755813887 (2^39 -1)', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20ScaleTaproot.lockingScriptHex),
                21475n
            )

            const preRemainingAmount = inputTokens.reduce(
                (acc, inputToken) => acc + inputToken.state.amount,
                0n
            )
            const preferBuyAmount = preRemainingAmount

            await expect(
                buycat20Call(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    preferBuyAmount,
                    keyInfo.xAddress,
                    keyInfo.xAddress,
                    inputTokens,
                    buycat20ScaleTaproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price,
                    preRemainingAmount,
                    true
                )
            ).to.be.rejectedWith(/expected false to equal true/)
        })

        it('t05: should fail if too much satoshis to seller', async () => {
            const inputTokens = await getTokenByNumber(
                1,
                hash160(buycat20ScaleTaproot.lockingScriptHex)
            )

            const preRemainingAmount = inputTokens[0].state.amount

            const preferBuyAmount = preRemainingAmount

            await expect(
                buycat20Call(
                    feeDeployUtxo,
                    keyInfo.seckey,
                    keyLocking,
                    preferBuyAmount,
                    keyInfo.xAddress,
                    keyInfo.xAddress,
                    inputTokens,
                    buycat20ScaleTaproot,
                    closedMinterTaproot.lockingScriptHex,
                    guardInfo,
                    price,
                    preferBuyAmount,
                    true,
                    preferBuyAmount * price * 256n + 100n
                )
            ).to.be.rejectedWith(/expected false to equal true/)
        })
    })
})
