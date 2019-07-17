"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
let tempDirectory = process.env['RUNNER_TEMPDIRECTORY'] || '';
const core = __importStar(require("@actions/core"));
const io = __importStar(require("@actions/io"));
const exec = __importStar(require("@actions/exec"));
const tc = __importStar(require("@actions/tool-cache"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const httpm = __importStar(require("typed-rest-client/HttpClient"));
const IS_WINDOWS = process.platform === 'win32';
if (!tempDirectory) {
    let baseLocation;
    if (IS_WINDOWS) {
        // On windows use the USERPROFILE env variable
        baseLocation = process.env['USERPROFILE'] || 'C:\\';
    }
    else {
        if (process.platform === 'darwin') {
            baseLocation = '/Users';
        }
        else {
            baseLocation = '/home';
        }
    }
    tempDirectory = path.join(baseLocation, 'actions', 'temp');
}
function getJava(version, arch, jdkFile) {
    return __awaiter(this, void 0, void 0, function* () {
        let toolPath = tc.find('Java', version);
        if (toolPath) {
            core.debug(`Tool found in cache ${toolPath}`);
        }
        else {
            let compressedFileExtension = '';
            if (!jdkFile) {
                core.debug('Downloading Jdk from Azul');
                jdkFile = yield downloadJava(version);
                compressedFileExtension = IS_WINDOWS ? '.zip' : '.tar.gz';
            }
            else {
                core.debug('Retrieving Jdk from local path');
            }
            compressedFileExtension = compressedFileExtension || getFileEnding(jdkFile);
            let tempDir = path.join(tempDirectory, 'temp_' + Math.floor(Math.random() * 2000000000));
            const jdkDir = yield unzipJavaDownload(jdkFile, compressedFileExtension, tempDir);
            core.debug(`jdk extracted to ${jdkDir}`);
            toolPath = yield tc.cacheDir(jdkDir, 'Java', normalizeVersion(version), arch);
        }
        let extendedJavaHome = 'JAVA_HOME_' + version + '_' + arch;
        core.exportVariable('JAVA_HOME', toolPath);
        core.exportVariable(extendedJavaHome, toolPath);
        core.addPath(path.join(toolPath, 'bin'));
    });
}
exports.getJava = getJava;
function normalizeVersion(version) {
    const versionArray = version.split('.');
    const major = versionArray[0];
    const minor = versionArray.length > 1 ? versionArray[1] : '0';
    const patch = versionArray.length > 2 ? versionArray[2] : '0';
    return `${major}.${minor}.${patch}`;
}
function getFileEnding(file) {
    let fileEnding = '';
    if (file.endsWith('.tar')) {
        fileEnding = '.tar';
    }
    else if (file.endsWith('.tar.gz')) {
        fileEnding = '.tar.gz';
    }
    else if (file.endsWith('.zip')) {
        fileEnding = '.zip';
    }
    else if (file.endsWith('.7z')) {
        fileEnding = '.7z';
    }
    else {
        throw new Error(`${file} has an unsupported file extension`);
    }
    return fileEnding;
}
function extractFiles(file, fileEnding, destinationFolder) {
    return __awaiter(this, void 0, void 0, function* () {
        const stats = fs.statSync(file);
        if (!stats) {
            throw new Error(`Failed to extract ${file} - it doesn't exist`);
        }
        else if (stats.isDirectory()) {
            throw new Error(`Failed to extract ${file} - it is a directory`);
        }
        if ('.tar' === fileEnding || '.tar.gz' === fileEnding) {
            yield tc.extractTar(file, destinationFolder);
        }
        else if ('.zip' === fileEnding) {
            yield tc.extractZip(file, destinationFolder);
        }
        else {
            // fall through and use sevenZip
            yield tc.extract7z(file, destinationFolder);
        }
    });
}
// This method recursively finds all .pack files under fsPath and unpacks them with the unpack200 tool
function unpackJars(fsPath, javaBinPath) {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs.existsSync(fsPath)) {
            if (fs.lstatSync(fsPath).isDirectory()) {
                for (const file in fs.readdirSync(fsPath)) {
                    const curPath = path.join(fsPath, file);
                    yield unpackJars(curPath, javaBinPath);
                }
            }
            else if (path.extname(fsPath).toLowerCase() === '.pack') {
                // Unpack the pack file synchonously
                const p = path.parse(fsPath);
                const toolName = IS_WINDOWS ? 'unpack200.exe' : 'unpack200';
                const args = IS_WINDOWS ? '-r -v -l ""' : '';
                const name = path.join(p.dir, p.name);
                yield exec.exec(`"${path.join(javaBinPath, toolName)}"`, [
                    `${args} "${name}.pack" "${name}.jar"`
                ]);
            }
        }
    });
}
function unzipJavaDownload(repoRoot, fileEnding, destinationFolder, extension) {
    return __awaiter(this, void 0, void 0, function* () {
        // Create the destination folder if it doesn't exist
        yield io.mkdirP(destinationFolder);
        const jdkFile = path.normalize(repoRoot);
        const stats = fs.statSync(jdkFile);
        if (stats.isFile()) {
            yield extractFiles(jdkFile, fileEnding, destinationFolder);
            const jdkDirectory = path.join(destinationFolder, fs.readdirSync(destinationFolder)[0]);
            yield unpackJars(jdkDirectory, path.join(jdkDirectory, 'bin'));
            return jdkDirectory;
        }
        else {
            throw new Error(`Jdk argument ${jdkFile} is not a file`);
        }
    });
}
function downloadJava(version) {
    return __awaiter(this, void 0, void 0, function* () {
        let filterString = '';
        if (IS_WINDOWS) {
            filterString = `jdk${version}-win_x64.zip`;
        }
        else {
            if (process.platform === 'darwin') {
                filterString = `jdk${version}-macosx_x64.tar.gz`;
            }
            else {
                filterString = `jdk${version}-linux_x64.tar.gz`;
            }
        }
        let http = new httpm.HttpClient('setup-java');
        let contents = yield (yield http.get('https://static.azul.com/zulu/bin/')).readBody();
        let refs = contents.match(/<a href.*\">/gi) || [];
        refs = refs.filter(val => {
            if (val.indexOf(filterString) > -1) {
                return true;
            }
        });
        if (refs.length == 0) {
            throw new Error(`No valid download found for version ${version}. Check https://static.azul.com/zulu/bin/ for a list of valid versions or download your own jdk file and add the jdkFile argument`);
        }
        const fileName = refs[0].slice('<a href="'.length, refs[0].length - '">'.length);
        return yield tc.downloadTool(`https://static.azul.com/zulu/bin/${fileName}`);
    });
}