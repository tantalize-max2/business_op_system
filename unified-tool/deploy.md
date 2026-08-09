---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '2117f300-1edf-455a-bc96-f1488946d679'
  PropagateID: '2117f300-1edf-455a-bc96-f1488946d679'
  ReservedCode1: 'cfd1a792-c924-42ec-a602-e44b3da665f2'
  ReservedCode2: 'cfd1a792-c924-42ec-a602-e44b3da665f2'
---

# 部署指南

本指南提供两种部署方式：
- **本地部署**（Windows/Mac，开发调试用，推荐首次使用）
- **Docker 部署**（Ubuntu 远程服务器，生产环境用）

两种方式默认端口均为 **9527**。

---

# 一、本地部署（Windows / macOS）

适合日常使用和开发调试，直接用本机 Python 运行，无需 Docker。

## 1. 前置条件

- **Python 3.9 ~ 3.12**（[下载地址](https://www.python.org/downloads/)，安装时勾选 "Add Python to PATH"）
- 验证安装：

```bash
python --version
```

## 2. 安装依赖

进入项目目录，安装 Python 依赖：

```bash
cd H:\Cursor_code\Teleclaw_workspace\business_op_system\unified-tool

pip install -r requirements.txt
```

> 如果 `requirements.txt` 安装报错（首行含零宽字符），可手动逐条安装：
> ```bash
> pip install flask flasgger flask-cors pandas openpyxl python-pptx matplotlib lxml requests playwright==1.60.0
> ```

## 3. 安装 Playwright 浏览器（邮件发送功能需要）

邮件发送模块依赖 Playwright 自动化登录电信邮箱，需额外安装一次 Chromium：

```bash
playwright install chromium
```

> 如果不使用邮件发送功能（Step8），可跳过此步。

## 4. 配置环境变量（可选）

本地开发可不配置，程序会自动创建 `data/` 目录。如需邮件发送等功能，复制环境变量模板：

```bash
copy .env.example .env
```

编辑 `.env`，填入邮箱信息：

```env
FLASK_DEBUG=1

# 邮箱配置（如需使用邮件发送功能）
MAIL_USERNAME=wangy592@chinatelecom.cn
MAIL_PASSWORD=你的邮箱密码
MAIL_AUTH_CODE=
MAIL_ACCOUNT=wangy592
MAIL_PHONE=你的手机号

# 安全配置（本地开发可留空）
API_TOKEN=
CORS_ORIGINS=
```

> 邮箱账号、密码、手机号也可在启动后通过 Step8 邮件模块的登录界面填写并保存。

## 5. 启动服务

**方式 A：双击启动脚本（最简单）**

直接双击项目根目录下的 `启动工具.bat`。

**方式 B：命令行启动**

```bash
python app.py
```

看到以下输出说明启动成功：

```
[文档] API 文档: http://localhost:9527/apidocs
 * Running on http://0.0.0.0:9527
```

## 6. 访问

浏览器打开 **http://localhost:9527**

> API 文档地址：http://localhost:9527/apidocs

## 7. 本地部署注意事项

| 事项 | 说明 |
|------|------|
| **Debug 模式** | 本地默认开启（`FLASK_DEBUG=1`），修改 Python 代码会自动重载，前端改动刷新浏览器即可 |
| **邮件登录** | 本地使用系统 Chrome 或 Playwright 自带 Chromium，首次登录需输入账号密码 + 短信验证码 |
| **在线推送文件浏览** | 本地可浏览整个磁盘文件系统，推送时直接选择本地 Excel 文件 |
| **数据存储** | 所有数据保存在项目下 `data/` 目录，备份只需拷贝此目录 |
| **停止服务** | 在命令行窗口按 `Ctrl + C`，或直接关闭窗口 |
| **端口占用** | 如 9527 被占用，修改 `app.py` 最后一行的 `port=9527` |

---

# 二、Docker 部署（Ubuntu 远程服务器）

适合生产环境或需长期稳定运行的场景。

## 1. 前置条件

远程 Ubuntu 服务器需安装 Docker 和 Docker Compose：

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sudo sh

# 启动 Docker 并设置开机自启
sudo systemctl start docker
sudo systemctl enable docker

# 验证安装
docker --version
docker compose version
```

## 2. 上传代码到服务器

### 方式 A：通过 Git 克隆（推荐）

```bash
# 在服务器上
cd /opt
git clone <你的仓库地址> business_op_system
cd business_op_system/unified-tool
```

### 方式 B：通过 SCP 上传

```bash
# 在本地 Windows 上执行（替换 IP 和路径）
scp -r H:\Cursor_code\Teleclaw_workspace\business_op_system\unified-tool root@<服务器IP>:/opt/business_op_system/
```

## 3. 配置环境变量

```bash
cd /opt/business_op_system/unified-tool

# 复制环境变量模板
cp .env.example .env

# 编辑 .env，填入邮箱密码和手机号
nano .env
```

`.env` 文件内容示例：

```env
FLASK_DEBUG=0
MAIL_USERNAME=wangy592@chinatelecom.cn （自己邮箱账号） 
MAIL_PASSWORD=你的邮箱密码
MAIL_AUTH_CODE=
MAIL_ACCOUNT=wangy592
MAIL_PHONE=你的手机号

# 安全配置（生产环境强烈建议设置）
# API 认证 Token：设置后所有 /api/ 请求需携带此值
# 前端在浏览器控制台执行 localStorage['api-token']='你的token' 即可生效
API_TOKEN=自定义一串随机字符串

# CORS 来源限制（逗号分隔），限制可访问的前端地址
CORS_ORIGINS=http://你的服务器IP:9527
```
> 需要替换自己的邮箱 MAIL_USERNAME、MAIL_PASSWORD 和 MAIL_PHONE（MAIL_AUTH_CODE 已废弃，留空即可）

### 安全说明
- **SMTP 授权码（MAIL_AUTH_CODE）**：已废弃，邮件发送改用 Playwright 自动登录，不依赖 SMTP 授权码，留空即可。
- **API Token**：留空时不启用（适合本地开发）；生产环境设置后可防止接口被未授权调用。前端通过 localStorage 配合：在浏览器控制台执行 `localStorage.setItem('api-token', '你的token')` 后刷新页面。
- **CORS 来源**：生产环境务必限定允许的前端地址。

## 4. 构建并启动

```bash
# 构建镜像并后台启动（首次约 5-10 分钟，需下载 Playwright 镜像）
docker compose up -d --build

# 查看启动日志
docker compose logs -f

# 看到类似以下输出说明启动成功：
#  * Running on http://0.0.0.0:9527
```

## 5. 验证

```bash
# 本地验证（在服务器上）
curl http://127.0.0.1:9527/api/email/login/status

# 浏览器访问（替换 IP）
# http://<服务器IP>:9527
```

## 6. 常用运维命令

```bash
# 查看状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 更新代码后重新部署
git pull                    # 或重新 SCP 上传
docker compose up -d --build

# 进入容器调试
docker compose exec web bash
```

## 7. 数据持久化说明

`data/` 目录已通过 volume 挂载到宿主机，容器重建后数据不丢失：

| 目录 | 说明 |
|------|------|
| `data/configs/` | 二级统计配置 |
| `data/bureau_mapping.json` | 分局映射 |
| `data/split_groups.json` | 拆分组配置 |
| `data/nz_templates/` | 数据标准化模板 |
| `data/email/contacts.json` | 邮件联系人 |
| `data/email/templates.json` | 邮件模板 |
| `data/email/login_creds.json` | 邮箱登录凭证 |
| `data/kdocs_sheets.json` | 在线表格配置 |
| `data/kdocs_categories.json` | 在线推送分类（含密码） |
| `data/uploads/` | 上传的原始文件 |

**备份**：只需备份整个 `data/` 目录即可。

## 8. 注意事项

1. **邮件登录**：Docker 中使用 Playwright 自带的无头 Chromium，首次登录可能比本地慢几秒，属正常现象。

2. **在线推送文件浏览**：Docker 环境中文件浏览范围限定在 `data/` 目录内。通过 step1 上传的文件会在 `data/uploads/` 下，推送时可从中选择。

3. **端口修改**：如需改端口，修改 `docker-compose.yml` 中的 `ports: - "9527:9527"`（左边为宿主机端口），同时修改 `app.py` 最后一行的 `port=9527`。

4. **内存要求**：Playwright + Chromium 至少需要 1GB 可用内存，建议服务器 2GB+。

5. **Google Fonts**：`index.html` 引用了 Google Fonts CDN，国内服务器可能加载慢（不影响功能，字体会自动 fallback）。

## 9. 防火墙放行（如需要）

```bash
# 放行 9527 端口
sudo ufw allow 9527/tcp

# 云服务器还需在安全组中放行 9527 端口
```

---

# 附录：两种部署方式对比

| 维度 | 本地部署 | Docker 部署 |
|------|---------|------------|
| 适用场景 | 开发调试、个人日常使用 | 生产环境、多人共享、长期运行 |
| 操作系统 | Windows / macOS | Ubuntu / 其他 Linux |
| 环境隔离 | 共享系统 Python | 容器隔离，互不影响 |
| 文件浏览 | 全磁盘可访问 | 限定 data/ 目录内 |
| 启动方式 | `python app.py` 或双击 .bat | `docker compose up -d` |
| 代码更新 | 自动重载（debug 模式） | 需重新 build 镜像 |
| 端口 | 9527 | 9527 |
| 数据目录 | 项目下 data/ | 挂载的 data/（持久化） |

> AI生成