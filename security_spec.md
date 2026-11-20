# School Library — Firestore Security Specification

## 1. Data Invariants
1. **Strict Librarian Isolation (Zero Public Access)**: No unauthenticated user may read or write any library collection. Every document carries `ownerUid` matching the authenticated verified user's UID.
2. **PII Protection**: `students` and `librarian_profiles` are readable only by their owner or a verified admin.
3. **Immutable Source Records**: `source_inventory_records.rawColumns`, `sourceRowNumber`, `sourceFileName`, `importBatchId`, and `createdAt` can never be overwritten during review updates.
4. **Immutable Audit Trail**: `activity_logs`, `loan_extensions`, and `import_batches` cannot be edited or deleted once created.
5. **Terminal Loan Locking**: Once a `loans` document reaches `status == 'returned'`, further updates are blocked (except admin recovery).
6. **Referential Integrity**: Creating a `physical_copies` record requires an existing `book_titles` document owned by the same user. Creating a `loans` record requires existing `students`, `book_titles`, and `physical_copies` documents owned by the same user.
7. **Temporal Integrity**: `createdAt` must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on updates.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /students/stu_1` with `auth == null`.
2. **Unverified Email Write**: `CREATE /students/stu_1` with `email_verified == false`.
3. **Identity Spoofing**: `CREATE /students/stu_1` where `ownerUid != request.auth.uid`.
4. **Cross-Tenant PII Read**: `GET /students/stu_other` where `resource.data.ownerUid != request.auth.uid`.
5. **Ghost Field / Shadow Update**: `UPDATE /students/stu_1` adding `{ isAdmin: true }`.
6. **Role Escalation**: `UPDATE /librarian_profiles/prof_1` modifying `role` to `'admin'`.
7. **ID Poisoning**: `CREATE /book_titles/invalid$$$id` failing `^[a-zA-Z0-9_\-]+$`.
8. **Size Overflow (Denial of Wallet)**: `CREATE /book_titles/book_1` with a 5,000-char `title`.
9. **Client Timestamp Forgery**: `CREATE /loans/loan_1` with client-supplied past `createdAt`.
10. **Terminal Loan Mutation**: `UPDATE /loans/loan_returned` changing `status` back to `'active'`.
11. **Source Inventory Tampering**: `UPDATE /source_inventory_records/rec_1` modifying `rawColumns` or `sourceRowNumber`.
12. **Audit Log Deletion**: `DELETE /activity_logs/log_1` by a regular user.
