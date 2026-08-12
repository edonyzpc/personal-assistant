#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const scanTarget = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(repoRoot, "src");

function collectTypeScriptFiles(target) {
    if (!fs.existsSync(target)) {
        throw new Error(`scan target does not exist: ${target}`);
    }
    const stat = fs.statSync(target);
    if (stat.isFile()) {
        return /\.tsx?$/u.test(target) && !target.endsWith(".d.ts") ? [target] : [];
    }
    if (!stat.isDirectory()) return [];

    const files = [];
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
        const child = path.join(target, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTypeScriptFiles(child));
        } else if (/\.tsx?$/u.test(entry.name) && !entry.name.endsWith(".d.ts")) {
            files.push(child);
        }
    }
    return files;
}

function isPlatformDesktop(node) {
    return ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "Platform"
        && node.name.text === "isDesktop";
}

function combineRequirements(left, right) {
    if (!left) return right;
    if (!right) return left;
    return left === right ? left : undefined;
}

function desktopRequirementWhen(expression, truthy) {
    if (ts.isParenthesizedExpression(expression)) {
        return desktopRequirementWhen(expression.expression, truthy);
    }
    if (isPlatformDesktop(expression)) {
        return truthy ? "desktop" : "mobile";
    }
    if (ts.isPrefixUnaryExpression(expression)
        && expression.operator === ts.SyntaxKind.ExclamationToken) {
        return desktopRequirementWhen(expression.operand, !truthy);
    }
    if (ts.isBinaryExpression(expression)) {
        if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            if (!truthy) return undefined;
            return combineRequirements(
                desktopRequirementWhen(expression.left, true),
                desktopRequirementWhen(expression.right, true),
            );
        }
        if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
            if (truthy) {
                const left = desktopRequirementWhen(expression.left, true);
                const right = desktopRequirementWhen(expression.right, true);
                return left && left === right ? left : undefined;
            }
            return combineRequirements(
                desktopRequirementWhen(expression.left, false),
                desktopRequirementWhen(expression.right, false),
            );
        }
    }
    return undefined;
}

function statementAlwaysExits(statement) {
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
    if (ts.isBlock(statement)) {
        for (const child of statement.statements) {
            if (statementAlwaysExits(child)) return true;
        }
        return false;
    }
    if (ts.isIfStatement(statement)) {
        return Boolean(statement.elseStatement)
            && statementAlwaysExits(statement.thenStatement)
            && statementAlwaysExits(statement.elseStatement);
    }
    return false;
}

function hasPriorDesktopEarlyExit(node) {
    let current = node;
    while (current.parent) {
        if (ts.isBlock(current.parent) && ts.isStatement(current)) {
            const statements = current.parent.statements;
            const index = statements.indexOf(current);
            for (const prior of statements.slice(0, index)) {
                if (ts.isIfStatement(prior)
                    && !prior.elseStatement
                    && desktopRequirementWhen(prior.expression, false) === "desktop"
                    && statementAlwaysExits(prior.thenStatement)) {
                    return true;
                }
            }
        }
        if (ts.isFunctionLike(current.parent)) break;
        current = current.parent;
    }
    return false;
}

function isStructurallyDesktopGuarded(node) {
    let current = node;
    while (current.parent) {
        const parent = current.parent;
        if (ts.isIfStatement(parent)) {
            if (current === parent.thenStatement
                && desktopRequirementWhen(parent.expression, true) === "desktop") return true;
            if (current === parent.elseStatement
                && desktopRequirementWhen(parent.expression, false) === "desktop") return true;
        }
        if (ts.isConditionalExpression(parent)) {
            if (current === parent.whenTrue
                && desktopRequirementWhen(parent.condition, true) === "desktop") return true;
            if (current === parent.whenFalse
                && desktopRequirementWhen(parent.condition, false) === "desktop") return true;
        }
        if (ts.isBinaryExpression(parent)
            && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
            && current === parent.right
            && desktopRequirementWhen(parent.left, true) === "desktop") return true;
        if (ts.isFunctionLike(parent)) break;
        current = parent;
    }
    return hasPriorDesktopEarlyExit(node);
}

function callName(node) {
    if (!ts.isCallExpression(node)) return undefined;
    if (ts.isIdentifier(node.expression)) return node.expression.text;
    if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
    return undefined;
}

function isWindowLeafCall(node) {
    return callName(node) === "getLeaf"
        && node.arguments.length > 0
        && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
        && node.arguments[0].text === "window";
}

function enclosingMethodName(node) {
    let current = node.parent;
    while (current) {
        if (ts.isMethodDeclaration(current) || ts.isMethodSignature(current)) {
            return current.name && ts.isIdentifier(current.name) ? current.name.text : undefined;
        }
        if (ts.isFunctionLike(current)) return undefined;
        current = current.parent;
    }
    return undefined;
}

function displayPath(file) {
    const relative = path.relative(repoRoot, file);
    return relative.startsWith("..") ? file : relative;
}

const errors = [];
let files;
try {
    files = collectTypeScriptFiles(scanTarget).sort();
} catch (error) {
    console.error(`Platform guard failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}

if (files.length === 0) {
    console.error(`Platform guard failed: no TypeScript files found under ${scanTarget}`);
    process.exit(1);
}

for (const file of files) {
    const sourceText = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
        file,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const diagnostic of sourceFile.parseDiagnostics) {
        const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        errors.push({
            file,
            line: position.line + 1,
            column: position.character + 1,
            rule: "parse-error",
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        });
    }

    const visit = (node) => {
        if (ts.isCallExpression(node) && isWindowLeafCall(node) && !isStructurallyDesktopGuarded(node)) {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            errors.push({
                file,
                line: position.line + 1,
                column: position.character + 1,
                rule: "desktop-window",
                message: 'getLeaf("window") requires a structural Platform.isDesktop guard',
            });
        }

        if (path.basename(file) === "settings.ts"
            && ts.isCallExpression(node)
            && callName(node) === "getConfiguredAPITokenSecret"
            && enclosingMethodName(node) !== "openApiTokenSecretEditor") {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            errors.push({
                file,
                line: position.line + 1,
                column: position.character + 1,
                rule: "settings-secret-render",
                message: "settings may read the configured token only inside the explicit token-editor method",
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
}

if (errors.length > 0) {
    console.error(`Platform guard failed with ${errors.length} violation(s):`);
    for (const error of errors) {
        console.error(`${displayPath(error.file)}:${error.line}:${error.column} [${error.rule}] ${error.message}`);
    }
    process.exit(1);
}

console.log(`Platform guards passed: ${files.length} TypeScript file(s).`);
