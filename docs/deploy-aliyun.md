# 阿里云部署保姆级教程（一步一步照着做）

> 目标：把项目从 GitHub 部署到你的阿里云服务器，装好就自动带 3000 个单词，用你自己的账号登录。
> 全程只需要：**一台阿里云服务器 + 一个 SSH 工具**。不需要装数据库、不需要 npm install、不需要容器。

---

## 第 0 步：准备工作

1. 买一台阿里云 ECS 服务器：
   - 系统选 **Ubuntu 22.04**（或 24.04），2 核 2G 以上即可（本项目很轻量）
   - 带宽选 1~3M 够用
2. 记下 3 样东西：
   - **公网 IP**（类似 `123.45.67.89`）
   - **用户名**（Ubuntu 默认 `root` 或 `ubuntu`）
   - **密码**（或密钥）
3. 打开阿里云控制台 → 你的实例 → **安全组** → 确认放行端口：
   - `22`（SSH，默认有）
   - `80` 和 `443`（网页访问，用 Nginx 反代时需要）
   - 如果你不想配 Nginx、想直接用 8788 端口访问，就再加放行 `8788`

---

## 第 1 步：连接服务器

### Windows 电脑（自带工具，不用装任何东西）

1. 按 `Win + R`，输入 `powershell`，回车打开 PowerShell
2. 输入下面命令回车，密码会提示输入（输入时不显示，正常）：

```powershell
ssh root@你的公网IP
```

- 第一次连接会问 `Are you sure you want to continue connecting?`，输入 `yes` 回车
- 输入密码回车（看不到字符是正常的）

看到类似 `root@xxx:~#` 的提示符就说明连上了。

---

## 第 2 步：安装 Node.js（唯一要装的东西）

在服务器上，**逐行**复制粘贴执行（一行一行来，每行回车）：

```bash
# 1) 下载 NodeSource 官方安装脚本
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# 2) 安装 Node.js（会连带装好 npm，但我们用不到 npm）
sudo apt-get install -y nodejs

# 3) 确认版本（必须 >= v22.13.0）
node -v
```

如果 `node -v` 显示的版本低于 `v22.13.0`，把 `setup_22.x` 换成 `setup_24.x` 重来一遍。

---

## 第 3 步：下载项目（自带 3000 词，零依赖）

```bash
# 1) 把 GitHub 上的项目克隆下来（先装 git，一般自带）
sudo apt-get install -y git

# 2) 克隆项目到 /opt/mistake-book
cd /opt
sudo git clone https://github.com/jyhj30269-arch/mistake-book.git

# 3) 进入项目目录
cd /opt/mistake-book
```

> 项目里已经有 `wordlists/cet6-3000.json`（3000 词词书），不需要从你电脑传任何东西。

---

## 第 4 步：启动服务（首次启动自动建库 + 建号 + 导入词书）

### 4.1 先把账号密码改成你自己的

把下面命令里的 **myuser / mypass123456** 换成你自己的账号密码（密码至少 8 位，别用弱密码），然后整行执行：

```bash
# 先设好环境变量（以后重启都用这一套）
echo 'export INIT_ADMIN_USER=myuser' >> ~/.bashrc
echo 'export INIT_ADMIN_PASSWORD=mypass123456' >> ~/.bashrc
echo 'export ALLOW_REGISTER=0' >> ~/.bashrc
echo 'export DISABLE_DEMO_ACCOUNT=1' >> ~/.bashrc
echo 'export AUTO_IMPORT_WORDS=1' >> ~/.bashrc
echo 'export DB_FILE=/opt/mistake-book/mistake-book.db' >> ~/.bashrc
source ~/.bashrc
```

> 这 6 个环境变量什么意思：
> - `INIT_ADMIN_USER/PASSWORD`：**首次启动自动创建你的登录账号**（这是你唯一能登录的账号）
> - `ALLOW_REGISTER=0`：关闭公开注册（防止陌生人注册进来）
> - `DISABLE_DEMO_ACCOUNT=1`：不创建 admin/admin123 演示账号（否则公网任何人可登录）
> - `AUTO_IMPORT_WORDS=1`：首次启动自动导入 3000 词，不用手动点
> - `DB_FILE`：数据库文件路径（不设会用默认位置，设了更明确）

### 4.2 前台启动测试

```bash
node server.js
```

看到这些就成功了：

```
个人工作台本地服务已启动：http://127.0.0.1:8788
数据库：.../mistake-book.db（... 题目 3015 道 · 账号 1 个）
AUTO_IMPORT_WORDS=1：已自动导入内置词书 3000 词
```

**重点看两行**：
- `题目 3015 道` = 15 道种子题 + **3000 词已经导入** ✅
- `账号 1 个` = 你的 `myuser` 建好了 ✅

按 `Ctrl + C` 停掉（下一步用 pm2 常驻）。

---

## 第 5 步：让服务常驻（关了 SSH 也不停）

```bash
# 安装 pm2（Node 进程管理器，全球通用）
sudo npm install -g pm2

# 用 pm2 启动（自动读取第 4 步设的环境变量）
cd /opt/mistake-book
pm2 start server.js --name mistake-book

# 保存进程列表 + 设置开机自启（照提示复制执行它给的命令）
pm2 save
pm2 startup
```

常用命令：

```bash
pm2 status            # 看服务状态（绿色 online 就正常）
pm2 logs mistake-book # 看日志
pm2 restart mistake-book  # 重启
pm2 stop mistake-book     # 停止
```

---

## 第 6 步：打开网页登录

### 方式 A：直接用 8788 端口（最快，不配 Nginx）

1. 阿里云安全组放行 `8788` 端口（见第 0 步）
2. 浏览器打开：`http://你的公网IP:8788`
3. 用第 4 步设的 `myuser / mypass123456` 登录
4. 登录后点侧边栏「🎴 背单词」，3000 词已经在里面了

> ⚠️ 用这个方式，账号密码是明文 HTTP 传输的，**自己用可以，要长期用建议走方式 B**。

### 方式 B：Nginx 反代 + 域名（推荐，可上 HTTPS）

```bash
# 装 Nginx
sudo apt-get install -y nginx

# 写配置文件（把 your-domain.com 换成你的域名）
sudo tee /etc/nginx/sites-available/mistake-book > /dev/null <<'EOF'
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF

# 启用配置
sudo ln -sf /etc/nginx/sites-available/mistake-book /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # 测试配置，显示 ok 再继续
sudo systemctl reload nginx

# 加 HTTPS（申请免费证书，没有域名可跳过这步）
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

配完后：
- 浏览器打开 `http://your-domain.com`（或 HTTPS）
- 如果你配了 HTTPS，重启服务时把 `COOKIE_SECURE=1` 也加进 `~/.bashrc` 那组环境变量里

---

## 第 7 步：更新代码（以后改完推到 GitHub 后）

```bash
cd /opt/mistake-book
sudo git pull
pm2 restart mistake-book
```

---

## 第 8 步：日常运维

| 事情 | 命令 |
|---|---|
| 看服务是否正常 | `pm2 status` |
| 看日志 | `pm2 logs mistake-book` |
| 手动备份数据库 | 登录网页 → 设置 → 下载整库备份（或直接复制 `/opt/mistake-book/mistake-book.db` 文件） |
| 自动备份 | 项目每天启动时自动备份到 `backups/`，保留 7 份 |
| 修改每日新词数 | 网页 → 设置 → 背单词 → 每日新词上限 |

---

## 常见问题

**Q：`node -v` 显示 v18 或 v12？**
A：系统自带的旧版本。用第 2 步的 NodeSource 脚本装，装完 `hash -r` 再试。

**Q：打开网页打不开 / 转圈？**
A：① 确认 `pm2 status` 是 online；② 确认阿里云安全组放行了对应端口；③ 试 `curl http://127.0.0.1:8788` 在服务器上能不能返回 HTML。

**Q：登录提示用户名或密码错误？**
A：首次启动前没设 `INIT_ADMIN_USER/PASSWORD` 的话不会建你的号。删掉数据库重新来：`rm /opt/mistake-book/mistake-book.db` 然后 `pm2 restart mistake-book`（会重新建号+导词书）。

**Q：OCR 识别报"未配置"？**
A：服务器没装识别服务。**推荐用云端 API 模式（免装 MinerU）**：把第 4 步的环境变量加上你的 MinerU Token 再重启：

```bash
echo 'export MINERU_API_TOKEN=你的sk-开头的Token' >> ~/.bashrc && source ~/.bashrc
pm2 delete mistake-book && pm2 start server.js --name mistake-book
pm2 logs mistake-book | grep OCR    # 应显示「MinerU 云端 API」
```

> 云端 API 走官方 Agent 通道：**不用装 MinerU、不用下模型**，单张图片 ≤10MB，识别稍慢（约 20~60 秒）但无需在服务器装任何东西。Token 在 https://mineru.net/apiManage/token 获取。没有 Token 也可设 `OCR_ENGINE=mock` 用模拟识别测试流程（不真实识别）。

**Q：热点资讯空白？**
A：服务器需要能访问外网 `aihot.virxact.com`；出网受限时该模块不可用，不影响其他功能。
