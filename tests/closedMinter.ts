import { NftClosedMinter } from '@cat-protocol/cat-smartcontracts'
import {
    CatTx,
    ContractCallResult,
    ContractIns,
    TaprootSmartContract,
} from '@cat-protocol/cat-smartcontracts'
import { CAT721Proto, CAT721State } from '@cat-protocol/cat-smartcontracts'
import {
    NftClosedMinterProto,
    NftClosedMinterState,
} from '@cat-protocol/cat-smartcontracts'

export async function nftClosedMinterDeploy(
    seckey,
    genesisUtxo,
    nftClosedMinter: NftClosedMinter,
    nftClosedMinterTaproot: TaprootSmartContract,
    nftClosedMinterState: NftClosedMinterState
): Promise<ContractIns<NftClosedMinterState>> {
    // tx deploy
    const catTx = CatTx.create()
    catTx.tx.from([genesisUtxo])
    const atIndex = catTx.addStateContractOutput(
        nftClosedMinterTaproot.lockingScript,
        NftClosedMinterProto.toByteString(nftClosedMinterState)
    )
    catTx.sign(seckey)
    return {
        catTx: catTx,
        contract: nftClosedMinter,
        state: nftClosedMinterState,
        contractTaproot: nftClosedMinterTaproot,
        atOutputIndex: atIndex,
    }
}

export async function nftClosedMinterCall(
    contractIns: ContractIns<NftClosedMinterState>,
    nftTaproot: TaprootSmartContract,
    nftState: CAT721State,
    collectionMax: bigint
): Promise<ContractCallResult<NftClosedMinterState | CAT721State>> {
    const catTx = CatTx.create()
    const atInputIndex = catTx.fromCatTx(
        contractIns.catTx,
        contractIns.atOutputIndex
    )
    const nexts: ContractIns<NftClosedMinterState | CAT721State>[] = []
    //
    const nextLocalId = contractIns.state.nextLocalId + 1n
    if (nextLocalId < collectionMax) {
        const nextState = NftClosedMinterProto.create(
            contractIns.state.nftScript,
            collectionMax,
            contractIns.state.nextLocalId + 1n
        )
        const atOutputIndex = catTx.addStateContractOutput(
            contractIns.contractTaproot.lockingScript,
            NftClosedMinterProto.toByteString(nextState)
        )
        nexts.push({
            catTx: catTx,
            contract: contractIns.contract,
            state: contractIns.state,
            contractTaproot: contractIns.contractTaproot,
            atOutputIndex: atOutputIndex,
        })
    }
    const atOutputIndex = catTx.addStateContractOutput(
        contractIns.state.nftScript,
        CAT721Proto.toByteString(nftState)
    )
    nexts.push({
        catTx: catTx,
        preCatTx: contractIns.catTx,
        contract: nftTaproot.contract,
        state: nftState,
        contractTaproot: nftTaproot,
        atOutputIndex: atOutputIndex,
    })
    return {
        catTx: catTx,
        contract: contractIns.contract,
        state: contractIns.state,
        contractTaproot: contractIns.contractTaproot,
        atInputIndex: atInputIndex,
        nexts: nexts,
    }
}
