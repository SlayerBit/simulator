import { z } from 'zod';

export const DurationSecondsSchema = z.number().int().min(5).max(3600);

export const IntensityPercentSchema = z.number().int().min(1).max(100);

export const LatencyMsSchema = z.number().int().min(10).max(60000);

export const PacketLossPercentSchema = z.number().int().min(1).max(100);

export const LabelSelectorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_.=,\-\s]+$/, 'Invalid label selector');
