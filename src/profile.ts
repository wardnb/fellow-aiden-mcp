/**
 * Brew profile and schedule validation.
 *
 * Ranges mirror what the Aiden accepts (ported from the community
 * `fellow-aiden` Python library). Temperatures are Celsius.
 */
import * as z from "zod";

const steps = (min: number, max: number, step: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Math.abs((v - min) / step - Math.round((v - min) / step)) < 1e-9, {
      message: `must be in steps of ${step} between ${min} and ${max}`,
    });

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const RANGES = {
  ratio: "14–20 in 0.5 steps (grams of water per gram of coffee)",
  bloomRatio: "1–3 in 0.5 steps (bloom water as a multiple of coffee weight)",
  bloomDuration: "1–120 seconds",
  temperature: "50–99 °C in 0.5 steps",
  pulsesNumber: "1–10",
  pulsesInterval: "5–60 seconds between pulses",
  title: "1–50 characters",
} as const;

const temp = steps(50, 99, 0.5);

export const ProfileFields = z.object({
    title: z.string().min(1).max(50).describe(`Profile name, ${RANGES.title}`),
    ratio: steps(14, 20, 0.5).describe(`Brew ratio, ${RANGES.ratio}`),
    bloomEnabled: z.boolean().describe("Whether to run a bloom phase"),
    bloomRatio: steps(1, 3, 0.5).describe(`Bloom ratio, ${RANGES.bloomRatio}`),
    bloomDuration: int(1, 120).describe(`Bloom time, ${RANGES.bloomDuration}`),
    bloomTemperature: temp.describe(`Bloom water temperature, ${RANGES.temperature}`),
    ssPulsesEnabled: z.boolean().describe("Pulse brewing for single-serve (cup) brews"),
    ssPulsesNumber: int(1, 10).describe(`Single-serve pulse count, ${RANGES.pulsesNumber}`),
    ssPulsesInterval: int(5, 60).describe(`Single-serve pulse interval, ${RANGES.pulsesInterval}`),
    ssPulseTemperatures: z
      .array(temp)
      .min(1)
      .max(10)
      .describe(`Single-serve temperature per pulse, one entry per pulse, ${RANGES.temperature}`),
    batchPulsesEnabled: z.boolean().describe("Pulse brewing for batch (carafe) brews"),
    batchPulsesNumber: int(1, 10).describe(`Batch pulse count, ${RANGES.pulsesNumber}`),
    batchPulsesInterval: int(5, 60).describe(`Batch pulse interval, ${RANGES.pulsesInterval}`),
    batchPulseTemperatures: z
      .array(temp)
      .min(1)
      .max(10)
      .describe(`Batch temperature per pulse, one entry per pulse, ${RANGES.temperature}`),
});

export const ProfileSchema = ProfileFields.superRefine((p, ctx) => {
    if (p.ssPulseTemperatures.length !== p.ssPulsesNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["ssPulseTemperatures"],
        message: `needs exactly ${p.ssPulsesNumber} entries (one per single-serve pulse), got ${p.ssPulseTemperatures.length}`,
      });
    }
    if (p.batchPulseTemperatures.length !== p.batchPulsesNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["batchPulseTemperatures"],
        message: `needs exactly ${p.batchPulsesNumber} entries (one per batch pulse), got ${p.batchPulseTemperatures.length}`,
      });
    }
  });

export type Profile = z.infer<typeof ProfileSchema>;

/** Fields the Fellow API accepts on create/update. Everything else is server-owned. */
export const PROFILE_FIELDS = [
  "title",
  "ratio",
  "bloomEnabled",
  "bloomRatio",
  "bloomDuration",
  "bloomTemperature",
  "ssPulsesEnabled",
  "ssPulsesNumber",
  "ssPulsesInterval",
  "ssPulseTemperatures",
  "batchPulsesEnabled",
  "batchPulsesNumber",
  "batchPulsesInterval",
  "batchPulseTemperatures",
] as const;

/** Keep only writable fields from a server profile (e.g. a shared brew link or an existing profile). */
export function pickProfileFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_FIELDS) if (raw[k] !== undefined && raw[k] !== null) out[k] = raw[k];
  return out;
}

/** Validate and return a clean payload, or throw a readable error listing every problem. */
export function validateProfile(input: unknown): Profile {
  const result = ProfileSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `- ${i.path.join(".") || "profile"}: ${i.message}`);
    throw new Error(`Profile is not valid for the Aiden:\n${lines.join("\n")}`);
  }
  return result.data;
}

export const ScheduleSchema = z.object({
  profileId: z
    .string()
    .regex(/^(p|plocal)\d+$/, "must be a profile id like p3")
    .describe("Profile to brew, e.g. p3"),
  days: z
    .array(z.boolean())
    .length(7)
    .describe("Seven booleans, Sunday through Saturday"),
  time: z
    .string()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM")
    .describe("Local brew time in 24-hour HH:MM, as shown on the brewer"),
  amountOfWater: int(150, 1500).describe("Water in ml, 150–1500"),
  enabled: z.boolean().default(true),
});

export type ScheduleInput = z.infer<typeof ScheduleSchema>;

export function scheduleToApi(s: ScheduleInput) {
  const [h, m] = s.time.split(":").map(Number);
  return {
    days: s.days,
    secondFromStartOfTheDay: h * 3600 + m * 60,
    enabled: s.enabled,
    amountOfWater: s.amountOfWater,
    profileId: s.profileId,
  };
}
