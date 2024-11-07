import { NftBurnGuard } from '@cat-protocol/cat-smartcontracts'
import {
    NftGuardConstState,
    NftGuardProto,
} from '@cat-protocol/cat-smartcontracts'
import { NftTransferGuard } from '@cat-protocol/cat-smartcontracts'
import {
    CatTx,
    TaprootMastSmartContract,
} from '@cat-protocol/cat-smartcontracts'

export const getNftGuardContractInfo = function () {
    const burnGuard = new NftBurnGuard()
    const transfer = new NftTransferGuard()
    const contractMap = {
        burn: burnGuard,
        transfer: transfer,
    }
    const guardInfo = new TaprootMastSmartContract(contractMap)
    return guardInfo
}

export async function nftGuardDeloy(
    feeUtxo,
    seckey,
    guardState: NftGuardConstState,
    guardInfo: TaprootMastSmartContract,
    burn: boolean
) {
    const catTx = CatTx.create()
    catTx.tx.from(feeUtxo)
    const locking = guardInfo.lockingScript
    const atIndex = catTx.addStateContractOutput(
        locking,
        NftGuardProto.toByteString(guardState)
    )
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: burn
            ? guardInfo.contractTaprootMap.burn.contract
            : guardInfo.contractTaprootMap.transfer.contract,
        state: guardState,
        contractTaproot: burn
            ? guardInfo.contractTaprootMap.burn
            : guardInfo.contractTaprootMap.transfer,
        atOutputIndex: atIndex,
    }
}
