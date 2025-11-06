import { unzip } from "unzipit";
import { assert, fetch_range, strip_prefix } from "./util.js";
export class BlobReader {
    blob;
    constructor(blob) {
        this.blob = blob;
    }
    async getLength() {
        return this.blob.size;
    }
    async read(offset, length) {
        const blob = this.blob.slice(offset, offset + length);
        return new Uint8Array(await blob.arrayBuffer());
    }
}
export class HTTPRangeReader {
    url;
    length;
    #overrides;
    constructor(url, opts = {}) {
        this.url = url;
        this.#overrides = opts.overrides ?? {};
    }
    async getLength() {
        if (this.length === undefined) {
            const req = await fetch(this.url, {
                ...this.#overrides,
                method: "HEAD",
            });
            assert(req.ok, `failed http request ${this.url}, status: ${req.status}: ${req.statusText}`);
            this.length = Number(req.headers.get("content-length"));
            if (Number.isNaN(this.length)) {
                throw Error("could not get length");
            }
        }
        return this.length;
    }
    async read(offset, size) {
        if (size === 0) {
            return new Uint8Array(0);
        }
        const req = await fetch_range(this.url, offset, size, this.#overrides);
        assert(req.ok, `failed http request ${this.url}, status: ${req.status} offset: ${offset} size: ${size}: ${req.statusText}`);
        return new Uint8Array(await req.arrayBuffer());
    }
}
/** @experimental */
class ZipFileStore {
    info;
    constructor(reader, opts = {}) {
        this.info = unzip(reader).then((info) => {
            if (opts.transformEntries) {
                info.entries = opts.transformEntries(info.entries);
            }
            return info;
        });
    }
    async get(key) {
        let entry = (await this.info).entries[strip_prefix(key)];
        if (!entry)
            return;
        return new Uint8Array(await entry.arrayBuffer());
    }
    async has(key) {
        return strip_prefix(key) in (await this.info).entries;
    }
    static fromUrl(href, opts = {}) {
        return new ZipFileStore(new HTTPRangeReader(href, opts), opts);
    }
    static fromBlob(blob, opts = {}) {
        return new ZipFileStore(new BlobReader(blob), opts);
    }
}
export default ZipFileStore;
//# sourceMappingURL=zip.js.map