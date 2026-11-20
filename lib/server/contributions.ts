import "server-only";
import type { Role } from "@/lib/badges";
import { termOf } from "@/lib/trackRecord";
import type { ReceiptFile } from "@/lib/receipt";
import type { ClubRecord } from "./clubs";
import type { EventRecord } from "./events";
import { db } from "./db";
import { getConnection } from "./mint";
import { prepareReceipt, sendReceipt } from "./receipts";

interface StoredReceipt {
  receipt_file: ReceiptFile;
  signed_transaction: string | null;
  last_valid_block_height: number;
  confirmed_at: string | null;
}

const COLUMNS = "receipt_file, signed_transaction, last_valid_block_height, confirmed_at";
const table = () => db().from("contribution_receipts");

/** One immutable contribution per event, wallet and role. The unique key chooses the winner
 * before any transaction is sent. A retry first reconciles the winner with Solana. */
export async function confirmContribution(
  event: EventRecord, club: ClubRecord, wallet: string, role: Role, summary: string,
) {
  const key = { event_id: event.id, wallet, role };
  const read = async (): Promise<StoredReceipt | null> => {
    const { data, error } = await table().select(COLUMNS).match(key).maybeSingle();
    if (error) throw new Error("Could not read the contribution");
    return data as StoredReceipt | null;
  };
  let row = await read();
  if (row && row.receipt_file.record.summary !== summary) return { status: "different_summary" };
  if (row?.confirmed_at) return { status: "already_awarded", signature: row.receipt_file.receipt.signature };

  if (!row) {
    const attendance = await db().from("claims").select("wallet").eq("event_id", event.id)
      .eq("wallet", wallet).eq("status", "confirmed").is("revoked_at", null).maybeSingle();
    if (attendance.error) throw new Error("Could not check attendance");
    if (!attendance.data) return { status: "not_checked_in" };
    const member = await db().from("members").select("name").eq("wallet", wallet).maybeSingle();
    if (member.error) throw new Error("Could not read the attendee");
    const record = {
      kind: "contribution", club: { id: club.id, name: club.name, issuer: club.issuer },
      person: { wallet, ...(member.data?.name ? { name: String(member.data.name) } : {}) },
      event: { id: event.id, name: event.name, date: event.date }, role, summary,
      term: termOf(event.date)?.label ?? "Undated", confirmedAt: new Date().toISOString(),
    };
    const prepared = await prepareReceipt(club, record);
    const inserted = await table().insert({ ...key, ...prepared });
    if (inserted.error && inserted.error.code !== "23505") throw new Error("Could not save the signed receipt");
    if (inserted.error) return { status: "in_progress" };
    row = { ...prepared, confirmed_at: null };
  }

  const signature = row.receipt_file.receipt.signature;
  if (row.confirmed_at) return { status: "already_awarded", signature };
  const connection = getConnection();
  // Read finalized height first, then transaction history. A node that has crossed the expiry
  // height has already seen the blocks in which the old transaction could have landed.
  const height = await connection.getBlockHeight("finalized");
  const { value: [status] } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const settled = status?.confirmationStatus === "finalized" || status?.confirmationStatus === "confirmed";
  if (status && !settled) return { status: "in_progress" };
  if (!status || status.err) {
    if (status?.err && status.confirmationStatus !== "finalized") return { status: "in_progress" };
    if (status?.err || height > row.last_valid_block_height) {
      // Preserve the original approval and salt. Only one concurrent retry can replace this attempt.
      const next = await prepareReceipt(club, row.receipt_file.record, row.receipt_file.salt);
      const swap = await table().update({ ...next, streamed_at: null }).match(key)
        .eq("signature", signature).is("confirmed_at", null).select("signature").maybeSingle();
      if (swap.error) throw new Error("Could not renew the signed receipt");
      if (!swap.data) return { status: "in_progress" };
      row = { ...next, confirmed_at: null };
    }
    if (!row.signed_transaction) throw new Error("Missing signed receipt");
    if (!await sendReceipt({ ...row, signed_transaction: row.signed_transaction })) return { status: "in_progress" };
  }

  const landed = row.receipt_file.receipt.signature;
  const saved = await table().update({ confirmed_at: new Date().toISOString(), signed_transaction: null })
    .match(key).eq("signature", landed).is("confirmed_at", null).select("signature").maybeSingle();
  if (saved.error) throw new Error("Could not save the confirmation. Retry to reconcile the receipt.");
  if (!saved.data) {
    const existing = await read();
    if (existing?.confirmed_at) return { status: "already_awarded", signature: existing.receipt_file.receipt.signature };
    return { status: "in_progress" };
  }
  return { status: "awarded", signature: landed };
}
