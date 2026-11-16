// QuickNode Streams filter for ShowedUp.
//
// Where it runs: inside QuickNode, on every new Solana devnet block (dataset "Block").
// What it does: keeps only the transactions where our organizer wallet handed someone an
// attendance token, and sends ShowedUp one small record per claim. Blocks with no claims
// send nothing.
//
// Setup: paste this whole file into the stream's filter editor and set ORGANIZER below to
// your organizer wallet address (README, "Live claim feed").

const ORGANIZER = "Bn38cCVx4BHdZ6Zcx5rqJinMncYcGyqhJeJe3gfvpfce";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function main(stream) {
  var data = stream && stream.data;
  var blocks = Array.isArray(data) ? data : [data];
  var claims = [];

  for (var i = 0; i < blocks.length; i++) {
    // Some datasets wrap each batch in another array; accept both.
    var group = Array.isArray(blocks[i]) ? blocks[i] : [blocks[i]];
    for (var g = 0; g < group.length; g++) {
      var block = group[g];
      if (!block || !Array.isArray(block.transactions)) continue;

      for (var t = 0; t < block.transactions.length; t++) {
        var tx = block.transactions[t];
        var meta = tx && tx.meta;
        if (!meta || meta.err || (meta.status && meta.status.Err)) continue; // failed transaction

        var message = tx.transaction && tx.transaction.message;
        var keys = message && message.accountKeys;
        if (!keys || !keys.length) continue;
        // The first account is the fee payer. Every ShowedUp claim is paid by the organizer.
        var feePayer = typeof keys[0] === "string" ? keys[0] : keys[0].pubkey;
        if (feePayer !== ORGANIZER) continue;

        // Token balances before and after the transaction, per token account.
        var before = {};
        var pre = meta.preTokenBalances || [];
        for (var p = 0; p < pre.length; p++) {
          before[pre[p].accountIndex] = Number((pre[p].uiTokenAmount || {}).amount || 0);
        }
        var post = meta.postTokenBalances || [];
        for (var q = 0; q < post.length; q++) {
          var b = post[q];
          if (b.programId !== TOKEN_2022 || !b.mint || !b.owner) continue;
          var after = Number((b.uiTokenAmount || {}).amount || 0);
          // A balance that went up = that wallet just received an attendance token.
          if (after > (before[b.accountIndex] || 0)) {
            claims.push({
              signature: tx.transaction.signatures[0],
              mint: b.mint,
              owner: b.owner,
              blockTime: block.blockTime || null,
              blockHeight: block.blockHeight || null,
            });
          }
        }
      }
    }
  }

  return claims.length ? { claims: claims } : null;
}
