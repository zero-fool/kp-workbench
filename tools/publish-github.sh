#!/usr/bin/env bash
# tools/publish-github.sh —— 一键发布到 GitHub Releases
#
# 把 dist/ 下的发布产物（仅绿色版 zip / 便携版 exe）按版本号建 Release 并上传为附件。
# 注意：发布规定 —— 只产绿色版 + 便携版，不再发布安装版。
# Release 正文（「更新通告」）由 tools/release-notes.js 依据 src/renderer/app.js 的 CHANGELOG 自动生成，
# 并附上绿色版下载须知。Release 与附件均已存在的会自动跳过，可重复执行（断点续传），
# 重复执行时会把已存在 Release 的通告正文刷新为最新内容。
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
  REPO="$(printf '%s' "$url" | sed -E 's#^.*github\.com[:/]##; s#\.git$##; s#/+$##')"
fi
case "$REPO" in
  */*) ;;
  *) echo "无法确定仓库，请设置 GH_REPO=owner/repo（当前：${REPO:-空}）"; exit 1 ;;
esac

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

# 附件名统一用 ASCII（GitHub 会把中文附件名规范化成 KP._vX_.exe，导致同类文件撞名）：
#   绿色版 zip → KP-workbench-vX.Y.Z-green.zip
#   便携版 exe → KP-workbench-vX.Y.Z-portable.exe
asset_name() {
  local b="$1" v
  v="$(printf '%s' "$b" | sed -nE 's/.*_v([0-9]+\.[0-9]+\.[0-9]+(_[0-9]+)?)_.*/\1/p')"
  case "$b" in
    *_绿色版.zip) printf 'KP-workbench-v%s-green.zip' "$v" ;;
    *_便携版.exe) printf 'KP-workbench-v%s-portable.exe' "$v" ;;
    *) printf '%s' "$b" ;;
  esac
}

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
done < <(find "$DIST" -maxdepth 1 -type f \( -name '*_绿色版.zip' -o -name '*_便携版.exe' \) | sort)

[ -n "$versions" ] || { echo "没有找到可发布的产物（检查 dist/ 与版本号过滤）"; exit 0; }

# ---- 计算全局最高版本：补传旧版本时不能把它顶成 GitHub 的「latest」 ----
# GitHub 按「发布时间」决定 releases/latest，因此补传 3.1.3（晚于 3.1.4 创建）会抢走 latest。
# 这里先算出 dist + 线上合起来的最高版本，只有它才允许 make_latest=true，其余一律 false。
existing_tags="$(api "https://api.github.com/repos/$REPO/releases?per_page=100" | json_get 'o.map(x=>x.tag_name.replace(/^v/,"")).join("\n")')"
LATEST_V="$(printf '%s\n%s\n' "$(printf '%s' "$versions" | tr ' ' '\n')" "$existing_tags" | sed '/^[[:space:]]*$/d' | sort -V | tail -1)"
echo "最高版本（latest 目标）：v$LATEST_V"

for v in $versions; do
  tag="v$v"
  echo "===== 版本 $v（tag $tag）====="
  if [ "$v" = "$LATEST_V" ]; then make_latest="true"; else make_latest="false"; fi

  rel_json="$(api "https://api.github.com/repos/$REPO/releases/tags/$tag" || true)"
  rel_id="$(printf '%s' "$rel_json" | json_get 'o.id')"

  # 更新通告正文：由 src/renderer/app.js 的 CHANGELOG 生成，只列出本版真实存在的附件类型。
  kinds=""
  for f in "$DIST"/*_"v$v"_*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in
      *_绿色版.zip) kinds="$kinds green" ;;
      *_便携版.exe) kinds="$kinds portable" ;;
    esac
  done
  body="$(node "$ROOT/tools/release-notes.js" "$v" $kinds 2>/dev/null || true)"
  if [ -z "$body" ]; then
    body="KP 跑团工作台 $tag 发布。完整更新记录见应用内「更新公告」与 https://github.com/$REPO/releases"
    echo "  提示：CHANGELOG 中没有 $v，Release 正文退回通用说明"
  fi

  if [ -z "$rel_id" ]; then
    if [ "$DRY_RUN" = 1 ]; then echo "  [dry] 将创建 Release $tag"; rel_id="DRY"; else
      echo "  创建 Release $tag …"
      rel_id="$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=process.argv[1],ml=process.argv[2];process.stdout.write(JSON.stringify({tag_name:t,name:"KP跑团工作台 "+t,body:s,draft:false,prerelease:false,make_latest:ml}))})' "$tag" "$make_latest" \
        | api -X POST -H "Content-Type: application/json" "https://api.github.com/repos/$REPO/releases" -d @- | json_get 'o.id')"
      [ -n "$rel_id" ] || { echo "  创建失败，跳过"; continue; }
    fi
  else
    echo "  Release 已存在（id=$rel_id），同步更新通告正文 …"
    [ "$DRY_RUN" = 1 ] || printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.stringify({body:s}))})' \
      | api -X PATCH -H "Content-Type: application/json" "https://api.github.com/repos/$REPO/releases/$rel_id" -d @- >/dev/null || echo "  （正文更新失败，跳过）"
  fi

  # 已上传附件名单
  have=""
  if [ "$rel_id" != "DRY" ]; then
    have="$(api "https://api.github.com/repos/$REPO/releases/$rel_id/assets?per_page=100" | json_get 'o.map(a=>a.name).join("\n")')"
  fi

  for f in "$DIST"/*_"v$v"_*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in *_绿色版.zip|*_便携版.exe) ;; *) continue ;; esac
    name="$(basename "$f")"
    aname="$(asset_name "$name")"
    if printf '%s\n' "$have" | grep -Fqx "$aname"; then echo "  已存在，跳过：$aname"; continue; fi
    if [ "$DRY_RUN" = 1 ]; then echo "  [dry] 将上传：$aname ($(du -h "$f" | cut -f1))"; continue; fi
    echo "  上传：$aname ($(du -h "$f" | cut -f1)) …"
    api -X POST \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$f" \
      "https://uploads.github.com/repos/$REPO/releases/$rel_id/assets?name=$(urlenc "$aname")" \
      | json_get 'o.state==="uploaded"?"  -> ok":("  -> 失败: "+(o.message||""))' >&2 || echo "  -> 上传出错"
  done
done

# ---- 收尾：把 GitHub「latest」强制指回最高版本（补传旧版本后兜底纠正） ----
if [ "$DRY_RUN" != 1 ]; then
  latest_id="$(api "https://api.github.com/repos/$REPO/releases/tags/v$LATEST_V" | json_get 'o.id')"
  if [ -n "$latest_id" ]; then
    printf '{"make_latest":"true"}' | api -X PATCH -H "Content-Type: application/json" \
      "https://api.github.com/repos/$REPO/releases/$latest_id" -d @- >/dev/null \
      && echo "已将 latest 固定为 v$LATEST_V" || echo "（latest 固定失败，请手动检查）"
  fi
fi

echo "完成。查看：https://github.com/$REPO/releases"
