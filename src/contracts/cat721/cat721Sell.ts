// import { CAT721 } from '@cat-protocol/cat-sdk-v2'
// import {
//     SmartContract,
//     prop,
//     ByteString,
//     method,
//     PubKeyHash,
//     PubKey,
//     Sig,
//     SHPreimage,
//     FixedArray,
//     hash160,
//     StateUtils,
//     Int32,
//     assert,
//     TxUtils,
// } from '@scrypt-inc/scrypt-ts-btc'

// const MAX_OTHER_OUTPUT = 3

// export class CAT721Sell extends SmartContract {
//     @prop()
//     cat721Script: ByteString

//     @prop()
//     localId: Int32

//     @prop()
//     recvOutput: ByteString

//     @prop()
//     recvSatoshiBytes: ByteString

//     @prop()
//     sellerAddress: ByteString

//     constructor(
//         cat721Script: ByteString,
//         localId: Int32,
//         recvOutput: ByteString,
//         recvSatoshiBytes: ByteString,
//         sellerAddress: ByteString
//     ) {
//         super(...arguments)
//         this.cat721Script = cat721Script
//         this.localId = localId
//         this.recvOutput = recvOutput
//         this.recvSatoshiBytes = recvSatoshiBytes
//         this.sellerAddress = sellerAddress
//     }

//     @method()
//     public take(
//         nftInputIndex: Int32,
//         nftLocalId: Int32,
//         buyUserAddress: PubKeyHash,
//         nftSatoshiBytes: ByteString,
//         // sig data
//         cancel: boolean,
//         pubKeyPrefix: ByteString,
//         ownerPubKey: PubKey,
//         ownerSig: Sig,
//         // ctxs
//         outputList: FixedArray<ByteString, typeof MAX_OTHER_OUTPUT>
//     ) {
//         assert(this.ctx.inputIndexVal == 0n)
//         // check preimage
//         if (cancel) {
//             assert(hash160(pubKeyPrefix + ownerPubKey) == this.sellerAddress)
//             assert(this.checkSig(ownerSig, ownerPubKey))
//         } else {
//             // Check sighash preimage.
//             // ensure inputs have one token input
//             assert(
//                 this.ctx.spentScripts[Number(nftInputIndex)] ==
//                     this.cat721Script
//             )
//             // build outputs

//             // to buyer
//             const curStateHashes: ByteString = hash160(
//                 CAT721.stateHash({
//                     localId: this.localId !== -1n ? this.localId : nftLocalId,
//                     ownerAddr: buyUserAddress,
//                 })
//             )
//             const toBuyerTokenOutput = TxUtils.buildOutput(
//                 this.cat721Script,
//                 nftSatoshiBytes
//             )

//             // satoshi to seller
//             const toSellerOutput = TxUtils.buildOutput(
//                 this.recvOutput,
//                 this.recvSatoshiBytes
//             )

//             //
//             const curStateCnt: bigint = 1n
//             const stateOutput = StateUtils.getCurrentStateOutput(
//                 curStateHashes,
//                 curStateCnt,
//                 curTxoStateHashes
//             )
//             let outputs = stateOutput + toBuyerTokenOutput + toSellerOutput
//             for (let i = 0; i < MAX_OTHER_OUTPUT; i++) {
//                 outputs += outputList[i]
//             }
//             const hashOutputs = sha256(outputs)
//             assert(
//                 hashOutputs == shPreimage.hashOutputs,
//                 'hashOutputs mismatch'
//             )
//         }
//     }
// }
