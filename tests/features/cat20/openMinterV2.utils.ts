import {
    Cat20MinterUtxo,
    OpenMinterCat20Meta,
    deploy,
    mint,
    toTokenAddress,
} from '@cat-protocol/cat-sdk'
import { testSigner } from '../../utils/testSigner'
import { testChainProvider, testUtxoProvider } from '../../utils/testProvider'

export const FEE_RATE = 10
export const ALLOWED_SIZE_DIFF = 40 // ~ 1 inputs difference is allowed

export async function deployToken(info: OpenMinterCat20Meta) {
    return deploy(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        info,
        FEE_RATE
    )
}

export async function mintToken(
    cat20MinterUtxo: Cat20MinterUtxo,
    tokenId: string,
    info: OpenMinterCat20Meta
) {
    const changeAddress = await testSigner.getAddress()
    const tokenReceiverAddr = toTokenAddress(changeAddress)

    return mint(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        cat20MinterUtxo,
        tokenId,
        info,
        tokenReceiverAddr,
        changeAddress,
        FEE_RATE
    )
}
