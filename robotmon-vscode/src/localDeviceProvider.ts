import * as vscode from 'vscode';
import { exec, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as process from 'process';
import * as AdmZip from 'adm-zip';

import { Message, NotFound, ADBDownloadURL } from './constVariables';
import { Config } from './config';
import { LocalDevice } from './localDevice';
import { OutputLogger } from './logger';

export class LocalDeviceProvider implements vscode.TreeDataProvider<LocalDevice>  {

  private _onDidChangeTreeData: vscode.EventEmitter<LocalDevice | undefined> = new vscode.EventEmitter<LocalDevice | undefined>();
	readonly onDidChangeTreeData: vscode.Event<LocalDevice | undefined> = this._onDidChangeTreeData.event;
  private mAdbPath: string = "";

  constructor() {
    this.findAdb();
    if (this.mAdbPath === "") {
      OutputLogger.default.debug(`adb currently not found`);
      this.downloadAdb().then(() => {
        this.findAdb();
        if (this.mAdbPath !== "") {
          OutputLogger.default.debug(`Found adb path: ${this.mAdbPath}`);
        } else {
          OutputLogger.default.debug(`adb not found, you should install adb your self`);
        }
      });
    } else {
      OutputLogger.default.debug(`Found adb path: ${this.mAdbPath}`);
    }
  }

  public getTreeItem(element: LocalDevice): LocalDevice {
    return element;
  }

  public getChildren(element?: LocalDevice): Thenable<LocalDevice[]> {
    if (element === undefined) {
      return this.getDeviceIds();
    }
    return Promise.resolve([]);
  }

  private findAdb() {
    if (vscode.workspace.rootPath !== undefined) {
      let adbPath;
      if (process.platform === 'win32') {
        adbPath = path.join(vscode.workspace.rootPath, 'bin', 'adb.exe');
      } else {
        adbPath = path.join(vscode.workspace.rootPath, 'bin', 'adb');
      }
      if (fs.existsSync(adbPath)) {
        this.mAdbPath = adbPath;
        return;
      }
    }
    if (fs.existsSync(Config.getConfig().adbPath)) {
      return Config.getConfig().adbPath;
    }
    try {
      if (process.platform === 'win32') {
        this.mAdbPath = execSync("which adb.exe").toString().trim();
      } else {
        this.mAdbPath = execSync("which adb").toString().trim();
      }
    } catch(e) {}
  }

  private downloadAdb() {
    return new Promise(function(resolve, reject) {
      if (vscode.workspace.rootPath === undefined) {
        return reject();
      }
      const platform = process.platform;
      let downloadURL = "";
      if (platform === 'win32') {
        downloadURL = ADBDownloadURL.windows;
      } else if (platform === 'darwin') {
        downloadURL = ADBDownloadURL.darwin;
      } else if (platform === 'linux') {
        downloadURL = ADBDownloadURL.linux;
      }
      const binPath = path.join(vscode.workspace.rootPath, 'bin');
      if (!fs.existsSync(binPath)) {
        fs.mkdirSync(binPath);
      }
      const adbZipPath = path.join(binPath, 'adb.zip');
      const adbZipFile = fs.createWriteStream(adbZipPath);
      OutputLogger.default.debug(`Download ${downloadURL} ...`);
      https.get(downloadURL, function(response) {
        response.pipe(adbZipFile);
        adbZipFile.on('finish', () => {
          adbZipFile.close();
          const zip = new AdmZip(adbZipPath);
          zip.extractAllTo(binPath);
          fs.unlinkSync(adbZipPath);
          fs.chmodSync(path.join(binPath, 'adb'), 755);
          if (platform === 'win32') {
            fs.renameSync(path.join(binPath, 'adb'), path.join(binPath, 'adb.exe'));
          }
          OutputLogger.default.debug(`Extract ${downloadURL} Done`);
          resolve();
        }).on('error', (err) => {
          OutputLogger.default.error(`Download Error: ${err}`);
        });
      }).on('error', function(err) {
        fs.unlinkSync(adbZipPath);
        OutputLogger.default.error(`Download Error: ${err}`);
        reject();
      });
    });
  }

  public scan() {
    if (this.mAdbPath === "") {
      return vscode.window.showWarningMessage(Message.adbPathNotFound);
    }
    this._onDidChangeTreeData.fire();
  }

  public notifyItemChanged() {
    this._onDidChangeTreeData.fire();
  }

  public getDeviceIds(): Thenable<Array<LocalDevice>> {
    if (this.mAdbPath === "") {
      return Promise.resolve([]);
    }
    return new Promise((resolve, reject) => {
      const deviceIds: Array<LocalDevice> = [];
      exec(`${this.mAdbPath} devices`, (error, stdout, stderr) => {
        if (error !== null) {
          OutputLogger.default.error(error.message);
          return reject();
        }
        if (stderr !== "") {
          OutputLogger.default.warn(stderr);
        }
        if (stdout !== "") {
          const lines = stdout.split("\n");
          for (let line of lines) {
            if (line.search('offline') !== NotFound) {
              continue;
            }
            const tabs = line.split("\t");
            if (tabs.length >= 2) {
              deviceIds.push(new LocalDevice(tabs[0], this.mAdbPath));
            }
          }
        }
        resolve(deviceIds);
      });  
    });
  }

  public tcpConnect(ip: string, fromPort: string): Thenable<undefined> {
    let port = parseInt(fromPort);
    return new Promise((resolve, reject) => {
      exec(`${this.mAdbPath} connect ${ip}:${port};`, (error, stdout, stderr) => {
        let errMsg = "";
        if (error !== null) {
          errMsg = error.message;
        }
        if (stderr !== "") {
          errMsg = stderr;
        }
        if (errMsg === "") {
          const result = stdout.trim();
          if (result.search("failed") !== NotFound) {
            errMsg = `Can not connect to ${ip}:${port}`;
          } else if (result.search("already") !== NotFound) {
            errMsg = `Already connect to ${ip}:${port}`;
          } else if (result !== "" && errMsg === "") {
            return resolve();
          }
        }
        execSync(`${this.mAdbPath} disconnect ${ip}:${port};`);
        return reject(errMsg);
      });
    });
  }

}