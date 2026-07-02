import { MAX_SOURCE_REVIEW_AGE_DAYS, SOURCES, assertValidSourceRegistry, sourceReviewAgeDays } from "../src/sources.js";
import { compactScriptErrorMessage } from "./safe-error.js";

function main(): void {
  assertValidSourceRegistry(SOURCES);

  const reviewAges = SOURCES.map(source => ({
    id: source.id,
    reviewedAt: source.reviewedAt,
    ageDays: sourceReviewAgeDays(source.reviewedAt)
  }));

  const oldestReview = reviewAges.reduce((oldest, current) => (current.ageDays > oldest.ageDays ? current : oldest));
  const newestReview = reviewAges.reduce((newest, current) => (current.ageDays < newest.ageDays ? current : newest));

  console.log([
    "official_source_freshness=ok",
    `sources=${SOURCES.length}`,
    `max_review_age_days=${MAX_SOURCE_REVIEW_AGE_DAYS}`,
    `oldest_review_age_days=${oldestReview.ageDays}`,
    `oldest_source=${oldestReview.id}`,
    `oldest_reviewed_at=${oldestReview.reviewedAt}`,
    `newest_review_age_days=${newestReview.ageDays}`,
    `newest_source=${newestReview.id}`,
    `newest_reviewed_at=${newestReview.reviewedAt}`
  ].join(" "));
}

try {
  main();
} catch (error) {
  console.error(compactScriptErrorMessage(error));
  process.exit(1);
}
