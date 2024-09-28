import {
    CatTx,
    ContractIns,
    TaprootSmartContract,
} from '@cat-protocol/cat-smartcontracts/dist/lib/catTx'
import { CAT20Proto, CAT20State } from '@cat-protocol/cat-smartcontracts'
import { ByteString, MethodCallOptions, hash160, toByteString } from 'scrypt-ts'
import { deployNoStateContract } from './cat20'
import { getDummySigner, getDummyUTXO } from './utils/txHelper'
import { getTxCtx } from '@cat-protocol/cat-smartcontracts'
import { CAT20Sell } from '../src/contracts/cat20Sell'
import { unlockTaprootContractInput } from './utils/contractUtils'

export async function cat20SellCall(
    feeDeployUtxo,
    seckey,
    keyLocking: ByteString,
    sellChangeAmount: bigint,
    buyerAddr: ByteString,
    inputTokens: ContractIns<CAT20State>[],
    cat20SellTaproot: TaprootSmartContract
): Promise<ContractIns<CAT20State>[]> {
    const sell = await deployNoStateContract(
        feeDeployUtxo,
        seckey,
        cat20SellTaproot
    )
    const catTx = CatTx.create()
    for (const inputToken of inputTokens) {
        catTx.fromCatTx(inputToken.catTx, inputToken.atOutputIndex)
    }
    const sellInputIndex = catTx.fromCatTx(sell.catTx, sell.atOutputIndex)
    const totalInputAmount = inputTokens.reduce(
        (p, c) => p + c.state.amount,
        0n
    )
    const receivers = [
        CAT20Proto.create(totalInputAmount - sellChangeAmount, buyerAddr),
    ]
    if (sellChangeAmount > 0n) {
        const tokenChange = CAT20Proto.create(
            sellChangeAmount,
            hash160(cat20SellTaproot.lockingScriptHex)
        )
        receivers.push(tokenChange)
    }
    for (const receiver of receivers) {
        catTx.addStateContractOutput(
            inputTokens[0].contractTaproot.lockingScriptHex,
            CAT20Proto.toByteString(receiver)
        )
    }
    catTx.addContractOutput(
        keyLocking,
        Number(totalInputAmount - sellChangeAmount)
    )
    await sell.contract.connect(getDummySigner())
    const { shPreimage, prevoutsCtx, spentScripts } = await getTxCtx(
        catTx.tx,
        sellInputIndex,
        sell.contractTaproot.tapleafBuffer
    )
    const sellCall = await sell.contract.methods.take(
        catTx.state.stateHashList,
        0n,
        totalInputAmount - sellChangeAmount,
        sellChangeAmount,
        buyerAddr,
        toByteString('4a01000000000000'),
        false,
        toByteString(''),
        toByteString(''),
        () => toByteString(''),
        shPreimage,
        prevoutsCtx,
        spentScripts,
        {
            script: toByteString(''),
            satoshis: toByteString('0000000000000000'),
        },
        {
            fromUTXO: getDummyUTXO(),
            verify: false,
            exec: false,
        } as MethodCallOptions<CAT20Sell>
    )
    unlockTaprootContractInput(
        sellCall,
        sell.contractTaproot,
        catTx.tx,
        sell.catTx.tx,
        sellInputIndex,
        true,
        true
    )
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
