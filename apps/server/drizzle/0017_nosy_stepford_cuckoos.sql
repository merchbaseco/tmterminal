CREATE INDEX "mark_filing_date_idx" ON "mark" USING btree ("filing_date","serial_number");--> statement-breakpoint
CREATE INDEX "mark_registration_date_idx" ON "mark" USING btree ("registration_date","serial_number");--> statement-breakpoint
CREATE INDEX "mark_status_activity_idx" ON "mark" USING btree ("status_code","source_transaction_date","serial_number");