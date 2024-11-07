import {
    CatTx,
    ContractIns,
    TaprootMastSmartContract,
    TaprootSmartContract,
} from '@cat-protocol/cat-smartcontracts'
import {
    CAT20,
    CAT20Proto,
    CAT20State,
    GuardInfo,
    GuardProto,
    MAX_TOKEN_INPUT,
    MAX_TOKEN_OUTPUT,
    TransferGuard,
    emptyTokenArray,
    getBackTraceInfoSearch,
    getOutpointObj,
    getTxCtxMulti,
    getTxHeaderCheck,
} from '@cat-protocol/cat-smartcontracts'
import {
    ByteString,
    MethodCallOptions,
    fill,
    int2ByteString,
    toByteString,
} from 'scrypt-ts'
import { deployNoStateContract, guardDeloy } from './cat20'
import { getDummySigner, getDummyUTXO } from './utils/txHelper'
import { MAX_INPUT } from '@cat-protocol/cat-smartcontracts'
import { CAT20Sell } from '../src/contracts/cat20Sell'
import { unlockTaprootContractInput } from './utils/contractUtils'
import { SellUtil } from '../src/contracts/sellUtil'
import { btc } from '@cat-protocol/cat-smartcontracts'

export async function buycat20Call(
    feeDeployUtxo,
    seckey,
    keyLocking: ByteString,
    toBuyerAmount: bigint,
    buyerAddr: ByteString,
    sellerAddr: ByteString,
    inputTokens: ContractIns<CAT20State>[],
    buycat20Taproot: TaprootSmartContract,
    minterScript: string,
    guardInfo: TaprootMastSmartContract,
    price: bigint,
    preRemainingAmount: bigint,
    scalePrice: boolean = false,
    satoshisToSeller: bigint = 0n
): Promise<ContractIns<CAT20State>[]> {
    const guardState = GuardProto.createEmptyState()
    guardState.tokenScript = inputTokens[0].contractTaproot.lockingScriptHex
    for (let index = 0; index < MAX_TOKEN_INPUT; index++) {
        if (inputTokens[index]) {
            guardState.inputTokenAmountArray[index + 1] =
                inputTokens[index].state.amount
        }
    }
    const tokenInputIndex: bigint = 1n
    let preRemainingSatoshis = preRemainingAmount * price

    if (scalePrice) {
        preRemainingSatoshis = preRemainingSatoshis * 256n
    }
    const buycat20 = await deployNoStateContract(
        feeDeployUtxo,
        seckey,
        buycat20Taproot,
        Number(preRemainingSatoshis)
    )

    const guardDeployInfo = await guardDeloy(
        feeDeployUtxo,
        seckey,
        guardState,
        guardInfo,
        false
    )

    const spendAmountCtx: ByteString[] = []
    const catTx = CatTx.create()
    const buyInputIndex = catTx.fromCatTx(
        buycat20.catTx,
        buycat20.atOutputIndex
    )
    const buycat20UTXO = buycat20.catTx.getUTXO(buycat20.atOutputIndex)
    spendAmountCtx.push(
        SellUtil.int32ToSatoshiBytes(buycat20UTXO.satoshis, false)
    )
    for (const inputToken of inputTokens) {
        catTx.fromCatTx(inputToken.catTx, inputToken.atOutputIndex)
        const tokenUTXO = inputToken.catTx.getUTXO(inputToken.atOutputIndex)
        spendAmountCtx.push(
            SellUtil.int32ToSatoshiBytes(tokenUTXO.satoshis, false)
        )
    }
    const guardInputIndex = catTx.fromCatTx(
        guardDeployInfo.catTx,
        guardDeployInfo.atOutputIndex
    )
    const guardUTXO = guardDeployInfo.catTx.getUTXO(
        guardDeployInfo.atOutputIndex
    )
    spendAmountCtx.push(SellUtil.int32ToSatoshiBytes(guardUTXO.satoshis, false))

    const totalInputAmount = inputTokens.reduce(
        (p, c) => p + c.state.amount,
        0n
    )

    const receivers = [CAT20Proto.create(toBuyerAmount, buyerAddr)]

    const toSellerAmount = totalInputAmount - toBuyerAmount
    if (toSellerAmount > 0n) {
        const tokenChange = CAT20Proto.create(toSellerAmount, sellerAddr)
        receivers.push(tokenChange)
    }
    for (const receiver of receivers) {
        catTx.addStateContractOutput(
            inputTokens[0].contractTaproot.lockingScriptHex,
            CAT20Proto.toByteString(receiver)
        )
    }

    let costSatoshis = toBuyerAmount * price

    if (scalePrice) {
        costSatoshis = costSatoshis * 256n
    }

    const remainingSatoshis = preRemainingSatoshis - costSatoshis
    const locking = buycat20Taproot.lockingScript

    if (remainingSatoshis > 0n) {
        catTx.addContractOutput(locking, Number(remainingSatoshis))
    }

    const changeInfo = {
        script: keyLocking,
        satoshis: SellUtil.int32ToSatoshiBytes(
            satoshisToSeller === 0n ? costSatoshis : satoshisToSeller,
            false
        ),
    }

    catTx.tx.addOutput(
        new btc.Transaction.Output({
            satoshis: Number(costSatoshis),
            script: changeInfo.script,
        })
    )
    // call getTxCtxMulti
    const inputIndexList: number[] = []
    const scriptBuffers: Buffer[] = []
    // push sell
    inputIndexList.push(buyInputIndex)
    scriptBuffers.push(buycat20.contractTaproot.tapleafBuffer)
    for (let i = 0; i < inputTokens.length; i++) {
        inputIndexList.push(i + 1)
        scriptBuffers.push(inputTokens[i].contractTaproot.tapleafBuffer)
    }
    // push guard
    inputIndexList.push(guardInputIndex)
    scriptBuffers.push(guardDeployInfo.contractTaproot.tapleafBuffer)
    for (let i = 0; i < MAX_INPUT; i++) {
        if (typeof spendAmountCtx[i] === 'undefined') {
            spendAmountCtx.push(toByteString(''))
        }
    }
    const ctxList = getTxCtxMulti(catTx.tx, inputIndexList, scriptBuffers)
    // token unlock
    for (let i = 0; i < inputTokens.length; i++) {
        const inputToken = inputTokens[i]
        const { shPreimage, prevoutsCtx, spentScripts } = ctxList[i + 1]
        const preTx = inputToken.catTx.tx
        const prePreTx = inputToken.preCatTx?.tx
        const backtraceInfo = getBackTraceInfoSearch(
            preTx,
            prePreTx,
            inputToken.contractTaproot.lockingScriptHex,
            minterScript
        )
        const amountCheckTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
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
                isUserSpend: false,
                userPubKeyPrefix: toByteString(''),
                userPubKey: toByteString(''),
                userSig: toByteString(''),
                contractInputIndex: BigInt(buyInputIndex),
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
            i + 1,
            true,
            true
        )
    }
    // guard unlock
    {
        const { shPreimage, prevoutsCtx, spentScripts } =
            ctxList[guardInputIndex]
        const preTx = getTxHeaderCheck(guardDeployInfo.catTx.tx, 1)
        await guardDeployInfo.contract.connect(getDummySigner())
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
        // other output
        for (
            let index = receivers.length + 1;
            index < catTx.tx.outputs.length;
            index++
        ) {
            const output = catTx.tx.outputs[index]
            mixArray[index - 1] = output.script.toBuffer().toString('hex')
            outputSatoshiArray[index - 1] = int2ByteString(
                BigInt(output.satoshis),
                8n
            )
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
            inputTokens.length + 1,
            true,
            true
        )
    }
    // buy unlock
    {
        await buycat20.contract.connect(getDummySigner())
        const { shPreimage, prevoutsCtx, spentScripts } = ctxList[buyInputIndex]
        const buycat20Call = await buycat20.contract.methods.take(
            catTx.state.stateHashList,
            preRemainingAmount,
            toBuyerAmount,
            toSellerAmount,
            sellerAddr,
            toByteString('4a01000000000000'),
            tokenInputIndex,
            false,
            toByteString(''),
            toByteString(''),
            () => toByteString(''),
            shPreimage,
            prevoutsCtx,
            spentScripts,
            spendAmountCtx,
            {
                script: toByteString(''),
                satoshis: toByteString('0000000000000000'),
            },
            changeInfo,
            {
                fromUTXO: getDummyUTXO(),
                verify: false,
                exec: false,
            } as MethodCallOptions<CAT20Sell>
        )
        unlockTaprootContractInput(
            buycat20Call,
            buycat20.contractTaproot,
            catTx.tx,
            buycat20.catTx.tx,
            buyInputIndex,
            true,
            true
        )
    }
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
}
