-- Expand artwork_status enum to align with ArtworkLibraryPage workflow
-- Old values: Pending Review, Approved, Revision Needed, Rejected
-- New values: Draft, Pending Approval, Changes Requested, Approved, Archived

CREATE TYPE artwork_status_new AS ENUM (
  'Draft',
  'Pending Approval',
  'Changes Requested',
  'Approved',
  'Archived'
);

ALTER TABLE artworks ALTER COLUMN status DROP DEFAULT;

ALTER TABLE artworks
  ALTER COLUMN status TYPE artwork_status_new
  USING (
    CASE status::text
      WHEN 'Pending Review'  THEN 'Pending Approval'
      WHEN 'Revision Needed' THEN 'Changes Requested'
      WHEN 'Rejected'        THEN 'Archived'
      WHEN 'Approved'        THEN 'Approved'
      ELSE 'Draft'
    END
  )::artwork_status_new;

ALTER TABLE artworks ALTER COLUMN status SET DEFAULT 'Draft';

DROP TYPE artwork_status;
ALTER TYPE artwork_status_new RENAME TO artwork_status;
