-- ===========================================
-- Add TEST ticket type to sidequest_ticket_type enum
-- ===========================================

-- Add TEST to the enum (for testing tasks)
ALTER TYPE sidequest_ticket_type ADD VALUE IF NOT EXISTS 'TEST';

-- Add confidence_score column to tickets
-- This enables AI to indicate how confident it is about each ticket
ALTER TABLE public.sidequest_tickets
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(3, 2) CHECK (confidence_score >= 0 AND confidence_score <= 1);

COMMENT ON COLUMN public.sidequest_tickets.confidence_score IS 'AI confidence score (0-1) for this ticket. Tickets below threshold (e.g., 0.7) need manual review.';
