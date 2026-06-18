---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'eb1a6056-f122-456c-9013-7cc34a5e25a0'
  PropagateID: 'eb1a6056-f122-456c-9013-7cc34a5e25a0'
  ReservedCode1: '6fa6180c-65f8-44da-b448-25fa6d7b568d'
  ReservedCode2: '6fa6180c-65f8-44da-b448-25fa6d7b568d'
---

# 远程 Ubuntu Docker 部署指南

## 一、前置条件

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

## 二、上传代码到服务器

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

## 三、配置环境变量

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
MAIL_USERNAME=wangy592@chinatelecom.cn  
MAIL_PASSWORD=你的邮箱密码
MAIL_AUTH_CODE=你的SMTP授权码
MAIL_ACCOUNT=wangy592
MAIL_PHONE=你的手机号

# 安全配置（生产环境强烈建议设置）
# API 认证 Token：设置后所有 /api/ 请求需携带此值
# 前端在浏览器控制台执行 localStorage['api-token']='你的token' 即可生效
API_TOKEN=自定义一串随机字符串

# CORS 来源限制（逗号分隔），限制可访问的前端地址
CORS_ORIGINS=http://你的服务器IP:5557
```
> 需要替换自己的邮箱 MAIL_USERNAME、MAIL_AUTH_CODE 和 MAIL_PHONE

### 安全说明
- **SMTP 授权码**已改为仅从环境变量 `MAIL_AUTH_CODE` 读取，不再硬编码在代码中。
- **API Token**：留空时不启用（适合本地开发）；生产环境设置后可防止接口被未授权调用。前端通过 localStorage 配合：在浏览器控制台执行 `localStorage.setItem('api-token', '你的token')` 后刷新页面。
- **CORS 来源**：生产环境务必限定允许的前端地址。
## 四、构建并启动

```bash
# 构建镜像并后台启动（首次约 5-10 分钟，需下载 Playwright 镜像）
docker compose up -d --build

# 查看启动日志
docker compose logs -f

# 看到类似以下输出说明启动成功：
#  * Running on http://0.0.0.0:5557
```

## 五、验证

```bash
# 本地验证（在服务器上）
curl http://127.0.0.1:5557/api/email/login/status

# 浏览器访问（替换 IP）
# http://<服务器IP>:5557
```

## 六、常用运维命令

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

## 七、数据持久化说明

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
| `data/uploads/` | 上传的原始文件 |

**备份**：只需备份整个 `data/` 目录即可。

## 八、注意事项

1. **邮件登录**：Docker 中使用 Playwright 自带的无头 Chromium，首次登录可能比本地慢几秒，属正常现象。

2. **在线推送文件浏览**：Docker 环境中文件浏览范围限定在 `data/` 目录内。通过 step1 上传的文件会在 `data/uploads/` 下，推送时可从中选择。

3. **端口修改**：如需改端口，修改 `docker-compose.yml` 中的 `ports: - "5557:5557"`（左边为宿主机端口）。

4. **内存要求**：Playwright + Chromium 至少需要 1GB 可用内存，建议服务器 2GB+。

5. **Google Fonts**：`index.html` 引用了 Google Fonts CDN，国内服务器可能加载慢（不影响功能，字体会自动 fallback）。

## 九、防火墙放行（如需要）

```bash
# 放行 5557 端口
sudo ufw allow 5557/tcp

# 云服务器还需在安全组中放行 5557 端口
```

> AI生成