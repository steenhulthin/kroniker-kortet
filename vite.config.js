var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
function ruksReleaseAssetProxy() {
    return {
        name: "ruks-release-asset-proxy",
        configureServer: function (server) {
            var _this = this;
            server.middlewares.use(function (req, res, next) { return __awaiter(_this, void 0, void 0, function () {
                var requestUrl, remoteUrl, upstream, contentType, contentLength, buffer, _a, _b, error_1, message;
                var _c, _d;
                return __generator(this, function (_e) {
                    switch (_e.label) {
                        case 0:
                            if (!((_c = req.url) === null || _c === void 0 ? void 0 : _c.startsWith("/api/ruks-release-asset"))) {
                                next();
                                return [2 /*return*/];
                            }
                            requestUrl = new URL(req.url, "http://127.0.0.1");
                            remoteUrl = requestUrl === null || requestUrl === void 0 ? void 0 : requestUrl.searchParams.get("url");
                            if (!remoteUrl) {
                                res.statusCode = 400;
                                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                                res.end("Missing required url parameter.");
                                return [2 /*return*/];
                            }
                            _e.label = 1;
                        case 1:
                            _e.trys.push([1, 4, , 5]);
                            return [4 /*yield*/, fetch(remoteUrl, {
                                    redirect: "follow",
                                    headers: {
                                        Accept: "application/octet-stream",
                                    },
                                })];
                        case 2:
                            upstream = _e.sent();
                            if (!upstream.ok) {
                                res.statusCode = upstream.status;
                                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                                res.end("Upstream fetch failed with ".concat(upstream.status, " ").concat(upstream.statusText));
                                return [2 /*return*/];
                            }
                            contentType = (_d = upstream.headers.get("content-type")) !== null && _d !== void 0 ? _d : "application/octet-stream";
                            contentLength = upstream.headers.get("content-length");
                            _b = (_a = Buffer).from;
                            return [4 /*yield*/, upstream.arrayBuffer()];
                        case 3:
                            buffer = _b.apply(_a, [_e.sent()]);
                            res.statusCode = 200;
                            res.setHeader("Content-Type", contentType);
                            if (contentLength) {
                                res.setHeader("Content-Length", contentLength);
                            }
                            res.setHeader("Cache-Control", "no-store");
                            res.end(buffer);
                            return [3 /*break*/, 5];
                        case 4:
                            error_1 = _e.sent();
                            message = error_1 instanceof Error ? error_1.message : "Unknown asset proxy error";
                            server.config.logger.error("[ruks-release-asset-proxy] ".concat(message));
                            res.statusCode = 502;
                            res.setHeader("Content-Type", "text/plain; charset=utf-8");
                            res.end("Asset proxy failed: ".concat(message));
                            return [3 /*break*/, 5];
                        case 5: return [2 /*return*/];
                    }
                });
            }); });
        },
    };
}
export default defineConfig({
    plugins: [react(), ruksReleaseAssetProxy()],
});
