import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

interface FunctionMetric {
  id: string;
  file: string;
  line: number;
  loc: number;
  cyclomatic: number;
  cognitiveApproximation: number;
}

function implementedFunction(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.body !== undefined;
}

function logical(node: ts.Node): boolean {
  return ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind);
}

function structural(node: ts.Node): boolean {
  return ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node)
    || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
    || ts.isCatchClause(node) || ts.isConditionalExpression(node);
}

function complexity(body: ts.Node) {
  let cyclomatic = 1;
  let cognitiveApproximation = 0;
  function visit(node: ts.Node, depth: number): void {
    if (implementedFunction(node)) return;
    const branch = structural(node);
    if (branch || logical(node) || ts.isCaseClause(node)) cyclomatic += 1;
    if (branch || ts.isSwitchStatement(node)) cognitiveApproximation += 1 + depth;
    if (logical(node)) cognitiveApproximation += 1;
    if (ts.isIfStatement(node) && node.elseStatement) cognitiveApproximation += 1;
    ts.forEachChild(node, (child) => visit(child, depth + Number(branch || ts.isSwitchStatement(node))));
  }
  visit(body, 0);
  return { cyclomatic, cognitiveApproximation };
}

function cycleComponents(graph: Map<string, Set<string>>): string[][] {
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const cycles: string[][] = [];
  let index = 0;
  function visit(node: string): void {
    indices.set(node, index);
    low.set(node, index++);
    stack.push(node);
    active.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node)!, low.get(target)!));
      } else if (active.has(target)) {
        low.set(node, Math.min(low.get(node)!, indices.get(target)!));
      }
    }
    if (low.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) cycles.push(component.sort());
  }
  for (const node of graph.keys()) if (!indices.has(node)) visit(node);
  return cycles.sort((left, right) => left.join().localeCompare(right.join()));
}

export function analyzeSources(sources: Record<string, string>, root = process.cwd()) {
  const absolute = new Map(Object.entries(sources).map(([file, text]) => [path.resolve(root, file), text]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, allowJs: true };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  host.readFile = (file) => absolute.get(path.resolve(file)) ?? originalRead(file);
  host.fileExists = (file) => absolute.has(path.resolve(file)) || originalExists(file);
  host.getSourceFile = (file, languageVersion) => {
    const text = host.readFile(file);
    return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
  };
  const program = ts.createProgram([...absolute.keys()], options, host);
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter((source) => absolute.has(path.resolve(source.fileName)));
  const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const graph = new Map(files.map((file) => [relative(file.fileName), new Set<string>()]));
  const functions: FunctionMetric[] = [];
  const functionIds = new Map<ts.Node, string>();
  const imports: { from: string; to: string; typeOnly: boolean }[] = [];
  const externalImports = new Set<string>();

  for (const source of files) {
    const file = relative(source.fileName);
    function visit(node: ts.Node): void {
      if (implementedFunction(node)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const endLine = source.getLineAndCharacterOfPosition(node.end).line + 1;
        const name = node.name?.getText(source)
          ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(source) : "anonymous");
        const column = source.getLineAndCharacterOfPosition(node.getStart(source)).character + 1;
        const id = `${file}:${line}:${column}:${name}`;
        functionIds.set(node, id);
        functions.push({ id, file, line, loc: endLine - line + 1, ...complexity(node.body) });
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
        const target = symbol?.declarations?.find(ts.isSourceFile);
        if (target && absolute.has(path.resolve(target.fileName))) {
          const to = relative(target.fileName);
          graph.get(file)!.add(to);
          const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly;
          imports.push({ from: file, to, typeOnly });
        } else {
          externalImports.add(specifier);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  const calls: { from: string; to: string }[] = [];
  let unresolvedOrExternalCalls = 0;
  for (const source of files) {
    function visit(node: ts.Node, owner: string): void {
      const caller = functionIds.get(node) ?? owner;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        const target = declaration && functionIds.get(declaration);
        if (target) calls.push({ from: caller, to: target });
        else unresolvedOrExternalCalls += 1;
      }
      ts.forEachChild(node, (child) => visit(child, caller));
    }
    visit(source, `${relative(source.fileName)}:<module>`);
  }
  const fileMetrics = files.map((source) => {
    const file = relative(source.fileName);
    const text = source.text;
    const loc = text.length === 0 ? 0 : text.split(/\r?\n/).length - Number(text.endsWith("\n"));
    return {
      file, loc,
      functions: functions.filter((entry) => entry.file === file).length,
      fanOut: graph.get(file)!.size,
      fanIn: [...graph.values()].filter((targets) => targets.has(file)).length,
    };
  }).sort((a, b) => a.file.localeCompare(b.file));
  return {
    schemaVersion: 1,
    files: fileMetrics,
    totalLoc: fileMetrics.reduce((sum, file) => sum + file.loc, 0),
    functions: functions.sort((a, b) => b.cyclomatic - a.cyclomatic || a.id.localeCompare(b.id)),
    imports, cycles: cycleComponents(graph), externalImports: [...externalImports].sort(),
    calls, unresolvedOrExternalCalls,
  };
}

function collectSources(root: string): Record<string, string> {
  const sources: Record<string, string> = {};
  function visit(relative: string): void {
    const target = path.join(root, relative);
    if (fs.statSync(target).isDirectory()) {
      for (const file of fs.readdirSync(target).sort()) visit(path.join(relative, file));
    } else if (/\.(ts|mjs)$/.test(relative)) sources[relative] = fs.readFileSync(target, "utf8");
  }
  for (const file of ["cli.ts", "src", "scripts", "test", "tools"]) visit(file);
  return sources;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = analyzeSources(collectSources(process.cwd()));
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Files: ${report.files.length}; physical LOC: ${report.totalLoc}; functions: ${report.functions.length}`);
    console.log(`Import cycles: ${report.cycles.length}; resolved local call sites: ${report.calls.length}; unresolved/external calls: ${report.unresolvedOrExternalCalls}`);
    console.table(report.functions.slice(0, 15));
  }
}
