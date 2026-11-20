// QuickNode Streams filter for ShowedUp.
//
// Where it runs: inside QuickNode, on every new Solana devnet block (dataset "Block").
// Keeps club receipt memos paid by our organizer, plus legacy token claims.
// A receipt delivery contains its signature, hash and block time.
//
// Setup: paste this whole file into the stream's filter editor and set ORGANIZER below to
// your organizer wallet address (README, "Live claim feed").

const ORGANIZER = "Bn38cCVx4BHdZ6Zcx5rqJinMncYcGyqhJeJe3gfvpfce";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const MEMO_V2 = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const PREFIX = "showedup:v1:";

// Raw RPC blocks encode instruction bytes in base58. QuickNode's filter has no Node imports.
function memoText(data) {
  if (typeof data !== "string" || data.length > 110) return "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = [];
  for (const char of data) {
    let carry = alphabet.indexOf(char);
    if (carry < 0) return "";
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 255;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 255); carry >>= 8; }
  }
  return String.fromCharCode(...bytes.reverse());
}

// QuickNode calls this entry point by name.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- QuickNode invokes main.
function main(stream) {
  var data = stream && stream.data;
  var blocks = Array.isArray(data) ? data : [data];
  var claims = [];
  var receipts = [];

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

        for (const ix of message.instructions || []) {
          const key = keys[ix.programIdIndex];
          const program = ix.programId || (typeof key === "string" ? key : key && key.pubkey);
          if (program !== MEMO_V2) continue;
          const text = typeof ix.parsed === "string" ? ix.parsed : memoText(ix.data);
          if (!/^showedup:v1:[a-f0-9]{64}$/.test(text)) continue;
          receipts.push({ signature: tx.transaction.signatures[0], hash: text.slice(PREFIX.length),
            blockTime: block.blockTime || null });
        }

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

  if (receipts.length) return { claims: claims, receipts: receipts };
  return claims.length ? { claims: claims } : null;
}
