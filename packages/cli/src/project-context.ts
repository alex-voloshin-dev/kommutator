import { defineCommand } from "citty";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ProjectContext, Projects, loadProjectContexts, pathsFor, projectContextRevision, updateProjectContext } from "@kommutator/agentd";

export interface ContextCommandOptions {
  cwd: string;
  remote?: string;
  project?: string;
  apply?: boolean;
  expectRevision?: string;
}

export async function manageProjectContext(action: "select" | "remove", options: ContextCommandOptions, home = pathsFor().home) {
  const cwd = resolve(options.cwd);
  if (action === "select" && !(await stat(cwd)).isDirectory()) throw new Error("cwd must be an existing directory");
  let selection: ProjectContext | undefined;
  if (action === "select") {
    const parsed = ProjectContext.safeParse({ cwd, remote: options.remote, project_key: options.project });
    if (!parsed.success) throw new Error("select requires cwd, sanitized normalized remote and a valid explicit project");
    selection = parsed.data;
  }
  const verify = async () => {
    if (selection && await new Projects().observe(cwd) !== selection.remote) {
      throw new Error("Git origin unavailable or differs from supplied normalized remote; verify checkout context");
    }
  };
  await verify();
  const entries = await loadProjectContexts(home);
  const prior = entries.find(entry => entry.cwd === cwd);
  const revision = projectContextRevision(cwd, prior);
  if (options.apply) {
    if (!options.expectRevision) throw new Error("apply requires --expect-revision from a preview");
    await updateProjectContext(home, cwd, selection, options.expectRevision, verify);
  }
  return {
    action, applied: options.apply ?? false, cwd, prior: prior ?? null,
    selection: selection ?? null, revision,
    topic: selection ? `project:${selection.project_key}` : null,
    activation: "Requires a compatible daemon restart and a new Claude OS owner/conversation or new independent Codex root. Existing owners and resumed Codex roots retain their project; old daemons ignore this file.",
  };
}

function command(action: "select" | "remove") {
  return defineCommand({
    meta: { name: action, description: `${action} future exact-checkout project context; defaults to preview` },
    args: {
      cwd: { type: "string", required: true },
      ...(action === "select" ? { remote: { type: "string" as const, required: true }, project: { type: "string" as const, required: true } } : {}),
      apply: { type: "boolean", default: false },
      "expect-revision": { type: "string" },
    },
    async run({ args }) {
      console.log(JSON.stringify(await manageProjectContext(action, {
        cwd: args.cwd, apply: args.apply,
        ...(typeof args.remote === "string" ? { remote: args.remote } : {}),
        ...(typeof args.project === "string" ? { project: args.project } : {}),
        ...(args["expect-revision"] ? { expectRevision: args["expect-revision"] } : {}),
      }), null, 2));
    },
  });
}

export const projectContextCommand = defineCommand({
  meta: { name: "project-context", description: "preview/apply private checkout selection; no hub contact or service restart" },
  subCommands: { select: command("select"), remove: command("remove") },
});
