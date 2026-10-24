import { describe, expect, it } from "vitest";
import { pickProfileFields, scheduleToApi, ScheduleSchema, validateProfile } from "../src/profile";

const base = {
  title: "Test",
  ratio: 16,
  bloomEnabled: true,
  bloomRatio: 2,
  bloomDuration: 30,
  bloomTemperature: 96,
  ssPulsesEnabled: true,
  ssPulsesNumber: 3,
  ssPulsesInterval: 23,
  ssPulseTemperatures: [96, 97, 98],
  batchPulsesEnabled: true,
  batchPulsesNumber: 2,
  batchPulsesInterval: 30,
  batchPulseTemperatures: [96, 97],
};

describe("validateProfile", () => {
  it("accepts the reference profile from the Python library", () => {
    expect(validateProfile(base)).toEqual(base);
  });

  it.each([
    ["ratio off-step", { ratio: 16.2 }],
    ["ratio too high", { ratio: 20.5 }],
    ["bloom ratio off-step", { bloomRatio: 2.2 }],
    ["bloom too long", { bloomDuration: 121 }],
    ["temperature too hot", { bloomTemperature: 99.5 }],
    ["pulse interval too short", { ssPulsesInterval: 4 }],
    ["too many pulses", { batchPulsesNumber: 11 }],
    ["title too long", { title: "x".repeat(51) }],
    ["temps don't match pulse count", { ssPulsesNumber: 2 }],
  ])("rejects %s", (_, change) => {
    expect(() => validateProfile({ ...base, ...change })).toThrow(/not valid/);
  });

  it("accepts edge values", () => {
    expect(() =>
      validateProfile({ ...base, ratio: 14, bloomRatio: 3, bloomDuration: 120, bloomTemperature: 50, ssPulsesNumber: 1, ssPulseTemperatures: [99], ssPulsesInterval: 60 }),
    ).not.toThrow();
  });

  it("lists every problem at once", () => {
    const msg = (() => {
      try {
        validateProfile({ ...base, ratio: 30, bloomDuration: 0 });
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(msg).toContain("ratio");
    expect(msg).toContain("bloomDuration");
  });
});

describe("pickProfileFields", () => {
  it("drops server-owned fields like id, folder and deviceId", () => {
    const server = { ...base, id: "p0", folder: "Custom", deviceId: "FB_x", synced: true, bloomRatio: null };
    const picked = pickProfileFields(server);
    expect(picked).not.toHaveProperty("id");
    expect(picked).not.toHaveProperty("deviceId");
    expect(picked).not.toHaveProperty("bloomRatio");
  });
});

describe("schedules", () => {
  it("converts HH:MM to seconds from midnight", () => {
    const s = ScheduleSchema.parse({ profileId: "p7", days: [true, true, false, true, false, true, false], time: "08:00", amountOfWater: 950 });
    expect(scheduleToApi(s)).toEqual({ days: s.days, secondFromStartOfTheDay: 28800, enabled: true, amountOfWater: 950, profileId: "p7" });
  });

  it("rejects bad times, water amounts and profile ids", () => {
    const ok = { profileId: "p7", days: Array(7).fill(true), time: "06:30", amountOfWater: 500 };
    expect(ScheduleSchema.safeParse({ ...ok, time: "25:00" }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...ok, amountOfWater: 1600 }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...ok, profileId: "x1" }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...ok, days: [true] }).success).toBe(false);
  });
});
