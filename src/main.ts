import {
  Notice,
  Plugin,
  Editor,
} from "obsidian";

import axios from "axios"
import objectPath from 'object-path'
import Compressor from 'compressorjs'
import path from 'path'

import ImageUploaderSettingTab from './settings-tab'

interface ImageUploaderSettings {
  apiEndpoint: string;
  token: string;
  maxWidth: number;
  enableResize: boolean;
  enableUploadToAlbum: boolean;
  defaultUploadAlbum: string;
  body: string;
}

const DEFAULT_SETTINGS: ImageUploaderSettings = {
  apiEndpoint: null,
  token: null,
  maxWidth: 4096,
  enableResize: false,
  enableUploadToAlbum: true,
  defaultUploadAlbum: null,
  body: null,
};


async function readFileAsDataURL(file) {
  let result_base64 = await new Promise((resolve) => {
    let fileReader = new FileReader();
    fileReader.onload = (e) => resolve(fileReader.result);
    fileReader.readAsDataURL(file);
  });

  return result_base64;
}

export default class ImageUploader extends Plugin {
  settings: ImageUploaderSettings;

  async postServerWithSearchParams(file:File): Promise<any> {
    const params = new URLSearchParams();
    params.append('key', this.settings.token);
    let dataURL = await readFileAsDataURL(file)
    
    const source = JSON.stringify(dataURL).split(',')[1].split('"')[0]
    params.append('source', source)

    // insert body param
    const bodyParam = this.settings.body
    if (bodyParam){
      const bodyParamObj = JSON.parse(bodyParam.toString());

      for(const key in bodyParamObj) {
        params.append(key, bodyParamObj[key]);
      }
    }

    if (this.settings.enableUploadToAlbum) {
      // get root folder as album Name
      const activePath = this.app.workspace.getActiveFile().path;
      const pathList = activePath.split('/');
      let albumName = "";
      if (pathList.length > 1) {
        albumName = pathList[0];
      }

      if (albumName.trim() != ""){
        const defaultUploadAlbum = this.settings.defaultUploadAlbum;
        if (defaultUploadAlbum && defaultUploadAlbum.trim() != "") {
          albumName = `${defaultUploadAlbum}/${albumName}`;
        }
        params.set("album_name", albumName);

        console.log(`Upload To Album ${albumName}`);
      }
    }

    return axios.post(this.settings.apiEndpoint, params);
  }

  async postServerWithFormData(file:File): Promise<any> {
    const params = new FormData();
    // insert body param
    const bodyParam = this.settings.body
    if (bodyParam){
      const bodyParamObj = JSON.parse(bodyParam.toString());

      for(const key in bodyParamObj) {
        params.append(key, bodyParamObj[key]);
      }
    }

    if (this.settings.enableUploadToAlbum) {
      // get root folder as album Name
      const activePath = this.app.workspace.getActiveFile().path;
      const pathList = activePath.split('/');
      pathList.pop();
      let albumName = "";
      if (pathList.length > 0) {
        albumName = pathList.shift();
      }

      if (albumName.trim() != ""){
        const defaultUploadAlbum = this.settings.defaultUploadAlbum;
        if (defaultUploadAlbum && defaultUploadAlbum.trim() != "") {
          albumName = `${defaultUploadAlbum}/${albumName}`;
        }
        params.set("album_name", albumName);

        console.log(`Upload To Album ${albumName}`);
      }

      // update file name
      if (pathList.length > 0) {
        const newName = `${pathList.join('-')}-${file.name}`;
  
        file = new File([file], newName, {
          type: file.type,
          lastModified: file.lastModified,
        })
      }

    }

    params.append('key', this.settings.token);
    params.append('source', file)

    return axios.post(this.settings.apiEndpoint, params);
  }

  setupPasteHandler(): void {
    if (!this.settings.apiEndpoint || !this.settings.token) {
      new Notice("Chevereto Image Uploader: Please check the chevereto settings.");
      return
    }
    this.registerEvent(this.app.workspace.on('editor-paste', async (evt: ClipboardEvent, editor: Editor) => {
      const { files } = evt.clipboardData;
      console.log(files);
      if (files.length != 0 && files[0].type.startsWith("image")) {
        evt.preventDefault();
        for (let file of files) {
          if (file.type.startsWith("image")) {
            const randomString = (Math.random() * 10086).toString(36).substr(0, 8)
            const pastePlaceText = `![uploading...](${randomString})\n`
            editor.replaceSelection(pastePlaceText)
            const maxWidth = this.settings.maxWidth
            if (this.settings.enableResize) {
              const compressedFile = await new Promise((resolve, reject) => {
                new Compressor(file, {
                  maxWidth: maxWidth,
                  success: resolve,
                  error: reject,
                })
              })
              file = compressedFile as File
            }
           
            this.postServerWithFormData(file)
              .then(res => {
                const url = objectPath.get(res.data, 'image.url')
                const imgMarkdownText = `![](${url})`
                this.replaceText(editor, pastePlaceText, imgMarkdownText)
              }, err => {
                new Notice(err, 5000)
                console.log(err)
              })
          }
        }
      }
    }))
  }

  // Function to replace text
  private replaceText(editor: Editor, target: string, replacement: string): void {
    target = target.trim()
    for (let i = 0; i < editor.lineCount(); i++) {
      const ch = editor.getLine(i).indexOf(target)
      if (ch !== -1) {
        const from = { line: i, ch };
        const to = { line: i, ch: ch + target.length };
        editor.replaceRange(replacement, from, to);
        break;
      }
    }
  }

  async onload(): Promise<void> {
    // console.log("loading Image Uploader");
    await this.loadSettings();
    this.setupPasteHandler()
    this.addSettingTab(new ImageUploaderSettingTab(this.app, this));
  }

  // onunload(): void {
  //   console.log("unloading Image Uploader");
  // }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
