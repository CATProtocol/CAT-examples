import { testSigner } from '../../utils/testSigner'
import { testChainProvider, testUtxoProvider } from '../../utils/testProvider'
import {
    Cat721MinterUtxo,
    NftParallelClosedMinterCat721Meta,
    deployParallelClosedMinter,
    toTokenAddress,
    mintNft as mint,
} from '@cat-protocol/cat-sdk'
import { Ripemd160 } from 'scrypt-ts'

export const FEE_RATE = 10
export const ALLOWED_SIZE_DIFF = 40 // ~ 1 inputs difference is allowed

export async function deployNft(info: NftParallelClosedMinterCat721Meta) {
    const address = await testSigner.getAddress()
    const ownerAddress = toTokenAddress(address)
    return deployParallelClosedMinter(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        ownerAddress,
        info,
        FEE_RATE,
        undefined
    )
}

export async function mintNft(
    cat721MinterUtxo: Cat721MinterUtxo,
    collectionId: string,
    info: NftParallelClosedMinterCat721Meta,
    nftReceiverAddr: Ripemd160
) {
    const address = await testSigner.getAddress()
    const ownerAddress = toTokenAddress(address)
    return mint(
        testSigner,
        testUtxoProvider,
        testChainProvider,
        ownerAddress,
        cat721MinterUtxo,
        collectionId,
        info,
        nftReceiverAddr,
        FEE_RATE,
        'text',
        'empty text',
        {}
    )
}
