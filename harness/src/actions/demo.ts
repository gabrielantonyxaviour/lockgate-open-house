import { type Ctx } from "../chain.js";
import { runStep } from "../progress.js";
import { ROLES } from "../roles.js";
import { expect, same } from "./common.js";
import { resumeDoor2, resumeStage2, resumeStage3 } from "./script.js";
import { resumeStage1 } from "./weekly.js";

export async function demoStage1(ctx: Ctx): Promise<unknown> {
  return runStep(ctx, "stage1", () => resumeStage1(ctx));
}

export async function demoStage2(ctx: Ctx): Promise<unknown> {
  return runStep(ctx, "stage2", () => resumeStage2(ctx));
}

export async function demoStage3(ctx: Ctx): Promise<unknown> {
  return runStep(ctx, "stage3", () => resumeStage3(ctx));
}

export async function demoAll(ctx: Ctx): Promise<unknown> {
  const stage1 = await demoStage1(ctx);
  const door2 = await runStep(ctx, "door2", () => resumeDoor2(ctx));
  const stage2 = await demoStage2(ctx);
  const stage3 = await demoStage3(ctx);
  expect(!same(ROLES.lockgate.address, ROLES.partnerA.address), "roles collided");
  return { stage1, door2, stage2, stage3 };
}
