/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Component } from "@flamework/components";
import { Essential } from "./Essential";
import { ToolAttributes, ToolInstance } from "./Tool";
import Config from "shared/Config";
import { CharacterLimb } from "shared/types";
import { Action } from "server/modules/Action";
import { Janitor } from "@rbxts/janitor";
import { playAnim } from "server/modules/AnimPlayer";
import { Events } from "server/events";
import FastCast, { Caster, FastCastBehavior } from "@rbxts/fastcast";
import PartCache from "@rbxts/partcache";

import { RunService, TweenService, Players } from "@rbxts/services";
import { PartCache as PartCacheType } from "@rbxts/partcache/out/class";
import { GenerateMiddleware, RunMiddleware } from "server/modules/Middleware";
import { Shield } from "./Shield";
import { Dependency } from "@flamework/core";
import {
	CreateBehaviorParams,
	DrawShoot,
	ManageRay,
	Ranged,
	ReleaseShot,
	SetupRanged,
} from "server/modules/RangedUtil";
import { CreateWeld } from "server/modules/CreateWeld";
import { isConstructSignatureDeclaration } from "typescript";

interface RangedInstance extends ToolInstance {
	BowAttach: BasePart;
	stringTOP: BasePart;
	stringBOTTOM: BasePart;
	stringMIDDLE: BasePart;
	Arrow: BasePart & {
		ArrowAttach: BasePart;
	};
}
const anims = Config.Animations.Bow;

@Component({
	tag: "Bow",
	defaults: {
		BUTTON_TOGGLE: "Two",
	},
})
export class Bow extends Essential<ToolAttributes, RangedInstance> implements Ranged {
	className = "Bow" as const;
	Gravity = new Vector3(0, -game.Workspace.Gravity / 6, 0);
	Ray = new Ray();
	AttachName = "BowAttach";
	Incompatible = ["Bow", "Shield", "RbxTool", "Sword", "Spear"];
	EnableAnimation = anims.Equip;
	DisableAnimation = anims.Holster;
	EnabledLimb = "LeftHand" as CharacterLimb;
	DisabledLimb = "UpperTorso" as CharacterLimb;
	ArrowMotor = new Instance("Motor6D");
	Damage = Config.ToolDamage[Tool.instance.Name][0] || 0;
	MaxDamage = Config.ToolDamage[Tool.instance.Name][1] || 40;
	MAX_DIST = 200;
	AnimationShootPosition = 2;
	Velocity = 250;
	MaxTime = 2;
	MinWaitTime = 1;
	WalkEffect = true;
	// @ts-ignore
	ActiveAnimation?: AnimationTrack;
	Time = tick();
	NotMoving = 0;
	Caster: Caster = new FastCast();

	Arrow: BasePart & {
		ArrowAttach: BasePart;
	};
	Provider: PartCacheType<BasePart>;
	CastParams: RaycastParams;
	Behavior: FastCastBehavior;
	MainPart: BasePart;

	constructor() {
		super();
		this.MainPart = this.BodyAttach;
		task.defer(() => {
			this.MainPart = this.BodyAttach;
		});
		this.Arrow = this.instance.Arrow;
		const Attachment0 = new Instance("Attachment");
		const Attachment1 = new Instance("Attachment");
		Attachment0.Position = new Vector3(0, -0.1, 0);
		Attachment1.Position = new Vector3(0, 0.1, 0);

		const Trail = new Instance("Trail");
		Trail.Attachment0 = Attachment0;
		Trail.Attachment1 = Attachment1;
		Trail.Transparency = new NumberSequence([
			new NumberSequenceKeypoint(0, 0.6),
			new NumberSequenceKeypoint(0.25, 0.7),
			new NumberSequenceKeypoint(0.5, 0.8),
			new NumberSequenceKeypoint(0.75, 0.9),
			new NumberSequenceKeypoint(1, 0.95),
		]);
		Trail.Lifetime = 3;

		const Factor = 100;
		Trail.MinLength = 0.1 * Factor;
		Trail.MaxLength = 10 * Factor;

		const NewArrow = this.Arrow.Clone();
		Attachment0.Parent = NewArrow;
		Attachment1.Parent = NewArrow;
		Trail.Parent = NewArrow;

		Trail.WidthScale = new NumberSequence([
			new NumberSequenceKeypoint(0, 1),
			new NumberSequenceKeypoint(0.25, 0.8),
			new NumberSequenceKeypoint(0.5, 0.6),
			new NumberSequenceKeypoint(0.75, 0.4),
			new NumberSequenceKeypoint(1, 0.2),
		]);

		Trail.Enabled = false;

		this.Provider = new PartCache(NewArrow, 10);

		const StoredArrows = new Instance("Folder");
		StoredArrows.Parent = game.Workspace;
		this.Provider.SetCacheParent(StoredArrows);

		this.InputInfo.Enabled.Begin = {
			MouseButton1: {
				Action: "Draw",
				Mobile: {
					Position: UDim2.fromScale(0.6175, 0.2),
				},
			},
		};

		const Top = new Instance("Attachment");
		const Middle = new Instance("Attachment");
		const Bottom = new Instance("Attachment");

		Top.Parent = this.instance.stringTOP;
		Middle.Parent = this.instance.stringMIDDLE;
		Bottom.Parent = this.instance.stringBOTTOM;

		const RodTemplate = new Instance("RodConstraint");
		RodTemplate.Attachment0 = Middle;
		RodTemplate.Visible = true;
		RodTemplate.Thickness = 0.02;
		RodTemplate.Color = new BrickColor("White");

		const RodTop = RodTemplate.Clone();
		const RodBottom = RodTemplate.Clone();

		RodTop.Parent = this.instance.stringMIDDLE;
		RodBottom.Parent = this.instance.stringMIDDLE;
		RodTop.Attachment1 = Top;
		RodBottom.Attachment1 = Bottom;

		[this.Behavior, this.CastParams] = CreateBehaviorParams(this, this.Provider);

		this.Caster.LengthChanged.Connect((cast, lastpoint, dir, displacement, segVel, arrow) => {
			if (!arrow?.IsA("BasePart")) {
				return;
			}

			if (arrow.GetAttribute("Visible") === undefined) {
				for (const v of arrow.GetDescendants()) {
					if (v.IsA("BasePart") && v.Name !== "ArrowAttach") {
						v.Transparency = 0;
					}
					if (v.IsA("Trail")) {
						v.Enabled = false;
					}
				}
				arrow.SetAttribute("Visible", true);
			}

			const Trail = arrow.FindFirstChildWhichIsA("Trail");
			if (Trail && !Trail.Enabled) {
				Trail.Enabled = true;
			}

			arrow.CFrame = CFrame.lookAt(lastpoint.add(dir.mul(displacement)), lastpoint);
		});

		this.InputInfo.Drawing = {
			End: {
				MouseButton1: {
					Action: "Release",
					Mobile: {
						Position: UDim2.fromScale(0.6175, 0.2),
					},
				},
			},
		};

		this.Actions.Draw = new Action((End, janitor) => this.Draw(End, janitor));
		this.Actions.Release = new Action((End, janitor) => this.Release(End, janitor));

		SetupRanged(this);
	}

	ReturnArrow(arrow: BasePart, weld: Weld) {
		if (!arrow.IsDescendantOf(game)) {
			opcall(() => {
				weld.Destroy();
				arrow.Destroy();
			});
			return;
		}
		for (const v of arrow.GetDescendants()) {
			if (v.IsA("BasePart") && v.Name !== "ArrowAttach") {
				v.Transparency = 0;
			}
			if (v.IsA("Trail")) {
				v.Enabled = false;
			}
		}
		weld.Destroy();
		arrow.Anchored = true;
		this.Provider.ReturnPart(arrow);
	}

	RangedHit(result: RaycastResult, instance: BasePart) {
		instance.Anchored = false;
		const Weld = CreateWeld(instance, result.Instance);
		Weld.Parent = result.Instance;

		const Player = Players.GetPlayerFromCharacter(result.Instance.Parent);
		let DeadConnection: RBXScriptConnection | undefined;
		let Died = false;
		if (Player && result.Instance.Parent?.IsA("Model")) {
			const Char = result.Instance.Parent;
			const Humanoid = Char.FindFirstChildWhichIsA("Humanoid");
			if (!Humanoid) {
				error("could not get humanoid");
			}

			if (Humanoid.Health <= 0) {
				return this.ReturnArrow(instance, Weld);
			} else {
				DeadConnection = Humanoid.Died.Connect(() => {
					DeadConnection?.Disconnect();
					Died = true;
					for (const v of instance.GetDescendants()) {
						if (v.IsA("BasePart")) {
							TweenService.Create(v, new TweenInfo(3), {
								Transparency: 1,
							}).Play();
						}
					}
					task.wait(3);
					return this.ReturnArrow(instance, Weld);
				});
			}
		}

		const Trail = instance.FindFirstChildWhichIsA("Trail");
		if (Trail) {
			Trail.Enabled = false;
		}

		task.wait(9);

		if (DeadConnection) {
			DeadConnection.Disconnect();
		}

		if (Died) {
			return;
		}

		if (instance.IsDescendantOf(game)) {
			for (const v of instance.GetDescendants()) {
				if (v.IsA("BasePart")) {
					TweenService.Create(v, new TweenInfo(1), {
						Transparency: 1,
					}).Play();
				}
			}
		}

		task.wait(1);
		this.ReturnArrow(instance, Weld);
	}

	Draw(End: Callback, janitor: Janitor) {
		this.setState("Drawing");
		this.ToggleArrow("Enable");

		DrawShoot(this, janitor, "HoldShoot", anims.Shoot);
	}

	Release(End: Callback, janitor: Janitor) {
		this.Actions.Draw.End();
		this.setState("Releasing");
		janitor.Add(() => {
			this.setState("Enabled");
		});
		this.ToggleArrow("Disable");

		ReleaseShot(this, End);
	}

	playerInit(player: Player) {
		if (!this.ArrowMotor.IsDescendantOf(game)) {
			this.ArrowMotor = new Instance("Motor6D");
		}

		const Limb = this.GetLimb("RightHand");
		this.ArrowMotor.Part0 = Limb;
		this.ArrowMotor.Part1 = this.Arrow.ArrowAttach;
		this.ArrowMotor.Parent = Limb;
		this.ArrowMotor.Name = "Arrow" + this.id;
		this.ToggleArrow("Disable");

		this.Arrow.Parent = this.instance;

		ManageRay(this);
	}

	ToggleArrow(state: "Enable" | "Disable") {
		const Transparency = state === "Enable" ? 0 : 1;
		for (const instance of this.Arrow.GetDescendants()) {
			if (instance.Name === "ArrowAttach") {
				continue;
			}
			if (instance.IsA("BasePart")) {
				instance.Transparency = Transparency;
			}
		}
	}

	Destroy() {
		this.Provider.Dispose();
	}

	WorkspaceInit = undefined;
}
