#!/usr/bin/env bash
# tools/publish-github.sh —— 一键发布到 GitHub Releases
#
# 把 dist/ 下的发布产物（绿色版 zip / 便携版 exe / 安装版 exe）按版本号建 Release 并上传为附件。
# 已存在的 Release 与已上传的附件会自动跳过，可重复执行（断点续传）。
#
# 用法：
#   GH_TOKEN=xxx bash tools/publish-github.sh            # 发布 dist 中所有尚未发布的版本
#   GH_TOKEN=xxx bash tools/publish-github.sh 3.1.2      # 只发布指定版本
#   GH_TOKEN=xxx bash tools/publish-github.sh --dry-run  # 只打印将要执行的动作
#
# 环境变量：
#   GH_TOKEN  必填，需具备目标仓库的 Contents: write 权限
#   GH_REPO   可选，形如 owner/repo；缺省时从 git remote origin 推断
#
# 依赖：curl（自动遵循 HTTP(S)_PROXY）、node（仅用于解析 JSON 与 URL 编码）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

: "${GH_TOKEN:?请先设置 GH_TOKEN（需目标仓库 Contents: write 权限）}"

# ---- 解析目标仓库 ----
REPO="${GH_REPO:-}"
if [ -z "$REPO" ]; then
  url="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
  REPO="$(printf '%s' "$url" | sed -E 's#.*github\.com[:/]([^/]+)/([^/]+?)(\.git)?$#\1/\2#')"
fi
[ -n "$REPO" ] && [ "$REPO" != "$url" ] || { echo "无法确定仓库，请设置 GH_REPO=owner/repo"; exit 1; }

# ---- 参数 ----
DRY_RUN=0
WANT_VERSION=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    -*) echo "未知参数：$a"; exit 1 ;;
    *) WANT_VERSION="$a" ;;
  esac
done

api() { curl -sS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$@"; }
json_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])??""))}catch(e){process.stdout.write("")}})' "$1"; }
urlenc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

echo "仓库：$REPO   产物目录：$DIST"
[ -d "$DIST" ] || { echo "dist/ 不存在，先执行打包"; exit 1; }

# ---- 收集产物并按版本归组 ----
versions=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  base="$(basename "$f")"
  v="$(printf '%s' "$base" | sed -nE 's/.*_v([0-9]+\.[0-9]+\.[0-9]+(_[0-9]+)?)_.*/\1/p')"
  [ -n "$v" ] || continue
  [ -n "$WANT_VERSION" ] && [ "$v" != "$WANT_VERSION" ] && continue
  case " $versions " in *" $v "*) ;; *) versions="$versions $v" ;; esac
done < <(find "$DIST" -maxdepth 1 -type f \( -name '*_绿色版.zip' -o -name '*_便携版.exe' -o -name '*_安装版.exe' \) | sort)

[ -n "$versions" ] || { echo "没有找到可发布的产物（检查 dist/ 与版本号过滤）"; exit 0; }

for v in $versions; do
  tag="v$v"
  echo "===== 版本 $v（tag $tag）====="

  rel_json="$(api "https://api.github.com/repos/$REPO/releases/tags/$tag" || true)"
  rel_id="$(printf '%s' "$rel_json" | json_get 'o.id')"

  if [ -z "$rel_id" ]; then
    if [ "$DRY_RUN" = 1 ]; then echo "  [dry] 将创建 Release $tag"; rel_id="DRY"; else
      echo "  创建 Release $tag …"
      rel_id="$(api -X POST "https://api.github.com/repos/$REPO/releases" \
        -d "$(node -e 'process.stdout.write(JSON.stringify({tag_name:process.argv[1],name:"KP跑团工作台 "+process.argv[2],body:"KP 跑团工作台 "+process.argv[2]+" 发布。详见应用内「更新公告」。",draft:false,prerelease:false}))' "$tag" "$tag")" | json_get 'o.id')"
      [ -n "$rel_id" ] || { echo "  创建失败，跳过"; continue; }
    fi
  else
    echo "  Release 已存在（id=$rel_id）"
  fi

  # 已上传附件名单
  have=""
  if [ "$rel_id" != "DRY" ]; then
    have="$(api "https://api.github.com/repos/$REPO/releases/$rel_id/assets?per_page=100" | json_get 'o.map(a=>a.name).join("\n")')"
  fi

  for f in "$DIST"/*_"v$v"_*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in *_绿色版.zip|*_便携版.exe|*_安装版.exe) ;; *) continue ;; esac
    name="$(basename "$f")"
    if printf '%s\n' "$have" | grep -Fqx "$name"; then echo "  已存在，跳过：$name"; continue; fi
    if [ "$DRY_RUN" = 1 ]; then echo "  [dry] 将上传：$name ($(du -h "$f" | cut -f1))"; continue; fi
    echo "  上传：$name ($(du -h "$f" | cut -f1)) …"
    api -X POST \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$f" \
      "https://uploads.github.com/repos/$REPO/releases/$rel_id/assets?name=$(urlenc "$name")" \
      | json_get 'o.state==="uploaded"?"  -> ok":("  -> 失败: "+(o.message||""))' >&2 || echo "  -> 上传出错"
  done
done

echo "完成。查看：https://github.com/$REPO/releases"
