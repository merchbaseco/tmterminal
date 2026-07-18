DROP INDEX "mark_word_mark_exact_idx";--> statement-breakpoint
DROP INDEX "mark_live_word_mark_exact_idx";--> statement-breakpoint
CREATE INDEX "mark_word_mark_exact_idx" ON "mark" USING hash ("word_mark_normalized");--> statement-breakpoint
CREATE INDEX "mark_live_word_mark_exact_idx" ON "mark" USING hash ("word_mark_normalized") WHERE "mark"."search_status" = 'live';