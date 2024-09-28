import * as dotenv from 'dotenv'
dotenv.config()

import { expect, use } from 'chai'
import {
    emptyTokenArray,
    getBackTraceInfoSearch,
    getTxHeaderCheck,
} from '@cat-protocol/cat-smartcontracts'
import chaiAsPromised from 'chai-as-promised'
import { MethodCallOptions, fill, hash160, toByteString } from 'scrypt-ts'
import {
    getOutpointObj,
    getOutpointString,
    getTxCtx,
} from '@cat-protocol/cat-smartcontracts'
import { CAT20Proto, CAT20State } from '@cat-protocol/cat-smartcontracts'
import { GuardProto } from '@cat-protocol/cat-smartcontracts'
import { CAT20, GuardInfo } from '@cat-protocol/cat-smartcontracts'
import { ClosedMinter } from '@cat-protocol/cat-smartcontracts'
import { TransferGuard } from '@cat-protocol/cat-smartcontracts'
import { CAT20Sell } from '../src/contracts/cat20Sell'
import {
    UTXO,
    getBtcDummyUtxo,
    getDummyGenesisTx,
    getDummySigner,
    getDummyUTXO,
} from './utils/txHelper'
import {
    MAX_INPUT,
    MAX_TOKEN_INPUT,
    MAX_TOKEN_OUTPUT,
} from '@cat-protocol/cat-smartcontracts'
import { KeyInfo, getKeyInfoFromWif, getPrivKey } from './utils/privateKey'
import { unlockTaprootContractInput } from './utils/contractUtils'
import {
    closedMinterCall,
    closedMinterDeploy,
    getGuardContractInfo,
    guardDeloy,
} from './cat20'
import {
    CatTx,
    ContractIns,
    TaprootMastSmartContract,
    TaprootSmartContract,
} from '@cat-protocol/cat-smartcontracts/dist/lib/catTx'
import { BurnGuard } from '@cat-protocol/cat-smartcontracts'
import { btc } from '@cat-protocol/cat-smartcontracts/dist/lib/btc'
import { cat20SellCall } from './cat20Sell'
use(chaiAsPromised)

export async function tokenTransferCall(
    feeGuardUtxo,
    feeTokenUtxo,
    seckey,
    pubKeyPrefix,
    pubkeyX,
    inputTokens: ContractIns<CAT20State>[],
    receivers: CAT20State[],
    minterScript: string,
    guardInfo: TaprootMastSmartContract,
    burn: boolean,
    options: {
        errorGuardTokenScript?: boolean
        errorGuardScript?: boolean
        errorGuardInputIndex?: boolean
        contractUnlock?: boolean
        wrongBacktraceInfo?: boolean
        withoutGuardInput?: boolean
        haveOutput?: boolean
        notOwner?: boolean
    } = {}
): Promise<ContractIns<CAT20State>[]> {
    const guardState = GuardProto.createEmptyState()
    guardState.tokenScript = inputTokens[0].contractTaproot.lockingScriptHex
    if (options.errorGuardTokenScript) {
        guardState.tokenScript = '0000'
    }
    for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
        if (inputTokens[index]) {
            guardState.inputTokenAmountArray[index] =
                inputTokens[index].state.amount
        }
    }
    const guardDeployInfo = await guardDeloy(
        feeGuardUtxo,
        seckey,
        guardState,
        guardInfo,
        burn,
        options.errorGuardScript
    )
    const catTx = CatTx.create()
    for (const inputToken of inputTokens) {
        catTx.fromCatTx(inputToken.catTx, inputToken.atOutputIndex)
    }
    catTx.fromCatTx(guardDeployInfo.catTx, guardDeployInfo.atOutputIndex)
    catTx.tx.from(feeTokenUtxo)
    if (!burn) {
        for (const receiver of receivers) {
            catTx.addStateContractOutput(
                guardState.tokenScript,
                CAT20Proto.toByteString(receiver)
            )
        }
    }
    if (options.haveOutput) {
        for (const receiver of receivers) {
            catTx.addStateContractOutput(
                guardState.tokenScript,
                CAT20Proto.toByteString(receiver)
            )
        }
    }
    for (let i = 0; i < inputTokens.length; i++) {
        const inputToken = inputTokens[i]
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(
                catTx.tx,
                i,
                inputToken.contractTaproot.tapleafBuffer
            )
        let sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        expect(
            btc.crypto.Schnorr.verify(seckey.publicKey, sighash.hash, sig)
        ).to.be.equal(true)
        const preTx = inputToken.catTx.tx
        const prePreTx = inputToken.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            inputToken.contractTaproot.lockingScriptHex,
            minterScript
        )
        if (options.wrongBacktraceInfo) {
            backtraceInfo.preTx.outputScriptList[0] += '00'
        }
        const amountCheckTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
        let guardInputIndex = inputTokens.length
        if (options.errorGuardInputIndex) {
            guardInputIndex -= 1
        }
        if (options.withoutGuardInput) {
            guardInputIndex = MAX_INPUT + 1
        }
        if (options.notOwner) {
            sig = ''
        }
        const amountCheckInfo: GuardInfo = {
            outputIndex: getOutpointObj(guardDeployInfo.catTx.tx, 1)
                .outputIndex,
            inputIndexVal: BigInt(guardInputIndex),
            tx: amountCheckTx.tx,
            guardState: guardDeployInfo.state,
        }
        await inputToken.contract.connect(getDummySigner())
        const tokenCall = await inputToken.contract.methods.unlock(
            {
                isUserSpend: !options.contractUnlock,
                userPubKeyPrefix: pubKeyPrefix,
                userPubKey: pubkeyX,
                userSig: sig.toString('hex'),
                contractInputIndex: BigInt(inputTokens.length + 1),
            },
            inputToken.state,
            inputToken.catTx.getPreState(),
            amountCheckInfo,
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT20>
        )
        unlockTaprootContractInput(
            tokenCall,
            inputToken.contractTaproot,
            catTx.tx,
            preTx,
            i,
            true,
            true
        )
    }
    const { shPreimage, prevoutsCtx, spentScripts } = await getTxCtx(
        catTx.tx,
        inputTokens.length,
        guardDeployInfo.contractTaproot.tapleafBuffer
    )
    const preTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
    await guardDeployInfo.contract.connect(getDummySigner())
    if (!burn) {
        const tokenOutputMaskArray = fill(false, MAX_TOKEN_OUTPUT)
        const tokenAmountArray = fill(0n, MAX_TOKEN_OUTPUT)
        const mixArray = emptyTokenArray()
        const outputSatoshiArray = emptyTokenArray()
        for (let i = 0; i < receivers.length; i++) {
            const receiver = receivers[i]
            tokenOutputMaskArray[i] = true
            tokenAmountArray[i] = receiver.amount
            mixArray[i] = receiver.ownerAddr
        }
        const tokenTransferCheckCall =
            await guardDeployInfo.contract.methods.transfer(
                catTx.state.stateHashList,
                mixArray,
                tokenAmountArray,
                tokenOutputMaskArray,
                outputSatoshiArray,
                toByteString('4a01000000000000'),
                guardDeployInfo.state,
                preTx.tx,
                shPreimage,
                prevoutsCtx,
                spentScripts,
                {
                    fromUTXO: getDummyUTXO(),
                    verify: false,
                    exec: false,
                } as MethodCallOptions<TransferGuard>
            )
        unlockTaprootContractInput(
            tokenTransferCheckCall,
            guardDeployInfo.contractTaproot,
            catTx.tx,
            guardDeployInfo.catTx.tx,
            inputTokens.length,
            true,
            true
        )
    } else {
        {
            const outputArray = emptyTokenArray()
            const outputSatoshiArray = emptyTokenArray()
            const burnGuardCall = await guardDeployInfo.contract.methods.burn(
                catTx.state.stateHashList,
                outputArray,
                outputSatoshiArray,
                guardDeployInfo.state,
                preTx.tx,
                shPreimage,
                prevoutsCtx,
                {
                    fromUTXO: getDummyUTXO(),
                    verify: false,
                    exec: false,
                } as MethodCallOptions<BurnGuard>
            )
            unlockTaprootContractInput(
                burnGuardCall,
                guardDeployInfo.contractTaproot,
                catTx.tx,
                guardDeployInfo.catTx.tx,
                inputTokens.length,
                true,
                true
            )
        }
    }
    if (!burn) {
        return receivers.map((tokenState, index) => {
            return {
                catTx: catTx,
                preCatTx: inputTokens[0].catTx,
                contract: inputTokens[0].contract,
                state: tokenState,
                contractTaproot: inputTokens[0].contractTaproot,
                atOutputIndex: index + 1,
            }
        })
    } else {
        return []
    }
}

export async function tokenBurnAndClosedMinterCall(
    feeGuardUtxo,
    feeTokenUtxo,
    seckey,
    pubKeyPrefix,
    pubkeyX,
    inputTokens: ContractIns<CAT20State>[],
    closedMinterIns: ContractIns<string>,
    receiver: CAT20State,
    minterScript: string,
    guardInfo: TaprootMastSmartContract
): Promise<ContractIns<CAT20State>[]> {
    const guardState = GuardProto.createEmptyState()
    guardState.tokenScript = inputTokens[0].contractTaproot.lockingScriptHex
    for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
        if (inputTokens[index]) {
            guardState.inputTokenAmountArray[index] =
                inputTokens[index].state.amount
        }
    }
    const guardDeployInfo = await guardDeloy(
        feeGuardUtxo,
        seckey,
        guardState,
        guardInfo,
        true
    )
    const catTx = CatTx.create()
    for (const inputToken of inputTokens) {
        catTx.fromCatTx(inputToken.catTx, inputToken.atOutputIndex)
    }
    catTx.fromCatTx(guardDeployInfo.catTx, guardDeployInfo.atOutputIndex)
    // add closedMinter contract
    catTx.fromCatTx(closedMinterIns.catTx, closedMinterIns.atOutputIndex)
    catTx.tx.from(feeTokenUtxo)
    // add output
    catTx.addStateContractOutput(
        closedMinterIns.state,
        CAT20Proto.toByteString(receiver)
    )
    for (let i = 0; i < inputTokens.length; i++) {
        const inputToken = inputTokens[i]
        const { shPreimage, prevoutsCtx, spentScripts, sighash } =
            await getTxCtx(
                catTx.tx,
                i,
                inputToken.contractTaproot.tapleafBuffer
            )
        const sig = btc.crypto.Schnorr.sign(seckey, sighash.hash)
        expect(
            btc.crypto.Schnorr.verify(seckey.publicKey, sighash.hash, sig)
        ).to.be.equal(true)
        const preTx = inputToken.catTx.tx
        const prePreTx = inputToken.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            inputToken.contractTaproot.lockingScriptHex,
            minterScript
        )
        const amountCheckTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
        const guardInputIndex = inputTokens.length
        const amountCheckInfo: GuardInfo = {
            outputIndex: getOutpointObj(guardDeployInfo.catTx.tx, 1)
                .outputIndex,
            inputIndexVal: BigInt(guardInputIndex),
            tx: amountCheckTx.tx,
            guardState: guardDeployInfo.state,
        }
        await inputToken.contract.connect(getDummySigner())
        const tokenCall = await inputToken.contract.methods.unlock(
            {
                isUserSpend: true,
                userPubKeyPrefix: pubKeyPrefix,
                userPubKey: pubkeyX,
                userSig: sig.toString('hex'),
                contractInputIndex: BigInt(inputTokens.length + 1),
            },
            inputToken.state,
            inputToken.catTx.getPreState(),
            amountCheckInfo,
            backtraceInfo,
            shPreimage,
            prevoutsCtx,
            spentScripts,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT20>
        )
        unlockTaprootContractInput(
            tokenCall,
            inputToken.contractTaproot,
            catTx.tx,
            preTx,
            i,
            true,
            true
        )
    }
    const { shPreimage, prevoutsCtx } = await getTxCtx(
        catTx.tx,
        inputTokens.length,
        guardDeployInfo.contractTaproot.tapleafBuffer
    )
    const preTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
    await guardDeployInfo.contract.connect(getDummySigner())
    const outputArray = emptyTokenArray()
    outputArray[0] = closedMinterIns.state
    const outputSatoshiArray = emptyTokenArray()
    outputSatoshiArray[0] = toByteString('4a01000000000000')
    const burnGuardCall = await guardDeployInfo.contract.methods.burn(
        catTx.state.stateHashList,
        outputArray,
        outputSatoshiArray,
        guardDeployInfo.state,
        preTx.tx,
        shPreimage,
        prevoutsCtx,
        {
            fromUTXO: getDummyUTXO(),
            verify: false,
            exec: false,
        } as MethodCallOptions<BurnGuard>
    )
    unlockTaprootContractInput(
        burnGuardCall,
        guardDeployInfo.contractTaproot,
        catTx.tx,
        guardDeployInfo.catTx.tx,
        inputTokens.length,
        true,
        true
    )
    return []
}

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
    let cat20SellTaproot: TaprootSmartContract
    let keyLocking: string
    let feeDeployUtxo

    before(async () => {
        // init load
        await CAT20Sell.loadArtifact()
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
            keyInfo.xAddress
        )
        cat20SellTaproot = TaprootSmartContract.create(cat20Sell)
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
        overflow: boolean = false
    ): Promise<ContractIns<CAT20State>[]> {
        const inputTokens: ContractIns<CAT20State>[] = []
        for (let i = 0; i < count; i++) {
            let amount = BigInt(Math.floor(Math.random() * 100)) + 10n
            if (overflow) {
                amount = BigInt(2147483647)
            }
            inputTokens.push(
                await mintToken(CAT20Proto.create(amount, xAddress))
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
                cat20SellTaproot
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
                cat20SellTaproot
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
                cat20SellTaproot
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
                cat20SellTaproot
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
                    cat20SellTaproot
                )
                if (nextTokens.length == 2) {
                    await sellMultiple([nextTokens[1]], amount - 1n)
                }
            }
            await sellMultiple(inputTokens, totalAmount)
        })
    })
})
