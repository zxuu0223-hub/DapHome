---
title: 每日捞——本地MiniMax H3部署
date: 2026-08-25T20:30:00+08:00
tags: [MiniMax H3, ComfyUI, 本地部署, CUDA, 视频生成]
summary: 在 Windows 与 RTX 4060 Ti 8GB 环境中，从检查硬件、安装 ComfyUI、配置 CUDA，到下载约 44.4GB 权重并跑通第一段 MiniMax H3 视频的完整实操记录。
---

## 写在前面

今天做的事情很明确：把 MiniMax H3 真正跑在自己的 Windows 电脑上，而不是调用云端接口。

我的机器是 NVIDIA GeForce RTX 4060 Ti 8GB，内存约 32GB。MiniMax H3 的模型体量明显超过 8GB 显存，所以这次部署的重点并不只是“把程序启动起来”，还要解决 CUDA、模型下载、显存卸载和低显存推理等问题。

最后使用的是官方 ComfyUI 和 `Comfy-Org/MiniMax-H3` 权重。第一次测试采用 8 步 Turbo 工作流，成功生成 MP4，单次任务实际耗时约 220 秒。

## 一、先确认电脑是否适合本地运行

我没有一上来就下载几十 GB 的模型，而是先在 PowerShell 检查显卡、显存和驱动：

```powershell
nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader
```

再检查磁盘空间：

```powershell
Get-PSDrive -PSProvider FileSystem |
  Select-Object Name,
    @{N='Free_GB';E={[math]::Round($_.Free/1GB,1)}},
    @{N='Used_GB';E={[math]::Round($_.Used/1GB,1)}}
```

这里要特别注意两件事：

- 完整模型文件总量约 44.4GB，下载过程中还会产生 Hugging Face 缓存，最好预留 60GB 以上空间。
- 8GB 显存无法让所有权重一直驻留在 GPU 中，后面必须启用 ComfyUI 的低显存和动态卸载机制。

我的工作目录放在 D 盘：

```text
D:\minimax H3 local
```

路径带空格时，PowerShell 命令中的路径需要用引号包住，脚本中则尽量使用 `Join-Path`，避免手工拼接路径出错。

## 二、下载官方 ComfyUI

进入工作目录后，克隆官方仓库：

```powershell
Set-Location 'D:\minimax H3 local'
git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git ComfyUI
```

`--depth 1` 只下载最新提交，不拉取完整 Git 历史。对本地运行来说足够，也能减少下载时间和占用空间。

这次使用的 ComfyUI 版本为 `0.33.0`。选择较新的官方版本，是因为其中已经包含 MiniMax H3 模型、视频 VAE、音频 VAE 和相关工作流支持，不需要再安装一批来源不明的自定义节点。

## 三、创建独立 Python 环境

为了不污染系统 Python，我在项目根目录创建了虚拟环境：

```powershell
python -m venv .venv
```

随后使用虚拟环境自己的 Python 安装依赖：

```powershell
Set-Location '.\ComfyUI'
& '..\.venv\Scripts\python.exe' -m pip install --upgrade pip
& '..\.venv\Scripts\python.exe' -m pip install -r requirements.txt
```

这里使用完整的解释器路径，而不是依赖 `Activate.ps1`。这样每条命令实际使用哪个 Python 非常清楚，即使 PowerShell 的脚本执行策略阻止激活虚拟环境，也不会影响安装。

## 四、修正 PyTorch 的 CUDA 版本

依赖安装结束后，我先验证 PyTorch 是否真的识别到显卡：

```powershell
Set-Location '..'
& '.\.venv\Scripts\python.exe' -c "import torch; print('torch', torch.__version__); print('cuda_build', torch.version.cuda); print('cuda_available', torch.cuda.is_available()); print('device', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NONE')"
```

这一步不能省。ComfyUI 能安装成功，不代表安装到的 PyTorch 一定支持当前 CUDA。如果输出中的 `cuda_available` 是 `False`，后面就可能退回 CPU，或者在加载模型时直接失败。

为了让本机 NVIDIA 驱动与 PyTorch 正确配合，我重新安装了 CUDA 13.0 构建：

```powershell
& '.\.venv\Scripts\python.exe' -m pip install --force-reinstall `
  torch torchvision torchaudio `
  --index-url https://download.pytorch.org/whl/cu130
```

然后再次检查：

```powershell
& '.\.venv\Scripts\python.exe' -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available()); print(torch.cuda.get_device_name(0)); print(round(torch.cuda.get_device_properties(0).total_memory/2**30, 2))"
```

最终识别结果是：

```text
PyTorch 2.13.0+cu130
CUDA 可用
NVIDIA GeForce RTX 4060 Ti
显存约 8GB
```

## 五、下载 MiniMax H3 模型文件

这次使用的仓库是：

```text
Comfy-Org/MiniMax-H3
```

完整的 T2V/I2V 推理需要以下文件：

```text
models/
├─ diffusion_models/
│  └─ minimax_h3_fl2va_pruned_int8_convrot.safetensors
├─ text_encoders/
│  └─ qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
├─ vae/
│  ├─ minimax_h3_video_vae_fp16.safetensors
│  └─ minimax_h3_audio_vae_fp32.safetensors
└─ loras/
   └─ minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors
```

它们分别承担以下工作：

- `diffusion_models`：MiniMax H3 主模型，负责视频与音频联合生成。
- `text_encoders`：把提示词转换为模型能够理解的语义特征。
- `video_vae`：在视频像素与压缩后的潜空间之间编码、解码。
- `audio_vae`：处理同步音频的潜空间表示。
- `Turbo LoRA`：把采样步骤压缩到 8 步，更适合 8GB 显存机器做首次测试。

为了避免浏览器手工下载大文件，也为了支持中断后继续下载，我写了 `download-h3-models.ps1`。核心逻辑如下：

```powershell
param(
    [switch]$WithoutTurbo
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Hf = Join-Path $Root '.venv\Scripts\hf.exe'
$Models = Join-Path $Root 'ComfyUI\models'

$env:HF_HOME = Join-Path $Root '.hf-cache'
$env:HF_HUB_CACHE = Join-Path $env:HF_HOME 'hub'
$env:HF_XET_CACHE = Join-Path $env:HF_HOME 'xet'

$Files = @(
    @{ Remote = 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors'; Local = 'diffusion_models' },
    @{ Remote = 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'; Local = 'text_encoders' },
    @{ Remote = 'vae/minimax_h3_video_vae_fp16.safetensors'; Local = 'vae' },
    @{ Remote = 'vae/minimax_h3_audio_vae_fp32.safetensors'; Local = 'vae' }
)

if (-not $WithoutTurbo) {
    $Files += @{ Remote = 'loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'; Local = 'loras' }
}

foreach ($File in $Files) {
    $Destination = Join-Path $Models $File.Local
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & $Hf download Comfy-Org/MiniMax-H3 $File.Remote --local-dir $Models
    if ($LASTEXITCODE -ne 0) {
        throw "Download failed: $($File.Remote)"
    }
}
```

在项目根目录执行：

```powershell
.\download-h3-models.ps1
```

如果暂时不想下载 Turbo LoRA，可以运行：

```powershell
.\download-h3-models.ps1 -WithoutTurbo
```

脚本把 Hugging Face 缓存固定到项目目录，方便观察下载进度，也不会把几十 GB 缓存散落到系统盘。下载意外中断后，重新运行同一个脚本即可继续，不必删除已经下载的文件。

## 六、以低显存模式启动 ComfyUI

模型就位后，我没有直接执行默认启动命令，而是为 8GB 显存写了专用启动脚本 `start-h3.ps1`：

```powershell
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root '.venv\Scripts\python.exe'
$ComfyUI = Join-Path $Root 'ComfyUI'

if (-not (Test-Path -LiteralPath $Python)) {
    throw 'Virtual environment not found. Run setup first.'
}

Set-Location -LiteralPath $ComfyUI
& $Python main.py `
  --lowvram `
  --reserve-vram 1.0 `
  --preview-method auto `
  --listen 127.0.0.1 `
  --port 8188 @args
```

每个参数的作用是：

- `--lowvram`：降低模型在 GPU 中的常驻量，必要时把权重卸载到内存。
- `--reserve-vram 1.0`：预留约 1GB 显存，减少 Windows 桌面和浏览器争抢显存导致的崩溃。
- `--preview-method auto`：让 ComfyUI 自动选择预览方式。
- `--listen 127.0.0.1`：只允许本机访问，不把服务暴露到局域网或公网。
- `--port 8188`：使用 ComfyUI 的常用端口。

启动命令为：

```powershell
.\start-h3.ps1
```

看到下面的日志，就说明服务已经正常监听：

```text
Starting server
To see the GUI go to: http://127.0.0.1:8188
```

然后在浏览器打开：

```text
http://127.0.0.1:8188
```

## 七、运行第一段 MiniMax H3 视频

进入 ComfyUI 后，我从模板库的 Video 分类选择 MiniMax H3 的 T2V 工作流。需要用图片作为起点时，也可以选择 I2V 模板。

首次测试没有挑战高分辨率和长视频，而是保留模板的预览尺寸，并采用约 5 秒、8 步 Turbo 的组合。这个顺序很重要：先验证模型、节点和输出链路全部可用，再逐步增加分辨率或时长。

运行时的关键日志包括：

```text
Set vram state to: LOW_VRAM
Device: cuda:0 NVIDIA GeForce RTX 4060 Ti
Requested to load MiniMaxH3TEModel_
Requested to load MiniMaxH3
Requested to load MiniMaxH3AudioVAE
Requested to load MiniMaxH3VideoVAE
Prompt executed in 220.02 seconds
```

最终文件生成在：

```text
ComfyUI\output\video\MiniMax_H3_00001_.mp4
```

这次 8 步采样本身约 161 秒，加上模型首次装载、VAE 解码和文件保存，整条任务耗时约 220 秒。对于 8GB 显存机器来说，速度不算快，但已经证明完整的本地音视频生成链路能够跑通。

## 八、今天遇到的问题与纠错

### 1. ComfyUI 装好了，却不等于 CUDA 可用

最容易误判的地方是：`pip install -r requirements.txt` 成功后就直接启动。实际上，PyTorch 的构建版本可能与本机环境不匹配。

正确做法是先检查：

```python
torch.cuda.is_available()
```

确认它返回 `True`，再开始下载模型和推理。否则几十 GB 模型下载完后才发现只能走 CPU，会浪费大量时间。

### 2. 从错误目录启动会找不到 `main.py`

ComfyUI 的入口文件位于 `ComfyUI\main.py`。如果在项目根目录直接运行：

```powershell
& '.\.venv\Scripts\python.exe' main.py
```

Python 会在错误的位置寻找 `main.py`。后来把脚本改成先 `Set-Location` 到 ComfyUI 目录，再执行入口文件，从根本上解决了当前目录不一致的问题。

### 3. 大模型下载中断不应该从零开始

模型总量超过 40GB，网络波动很正常。下载脚本使用 Hugging Face CLI 和固定缓存目录，重新运行时会复用已经完成的分片。

因此出现中断时，我的处理方式是：

```powershell
.\download-h3-models.ps1
```

而不是删除缓存、重新下载。

### 4. 8GB 显存不能照搬高显存参数

日志中主模型的暂存规模接近 20GB，文本编码器也接近 15GB，显然无法同时塞进 8GB 显存。真正使它能够运行的是低显存模式、CPU 内存卸载和动态显存管理。

首次测试应该避免从 `1344×768、15 秒、完整采样步数` 开始。先用短时长和 8 步 Turbo 跑通，再一点点提高质量，排错成本会低很多。

### 5. 本地服务不要随手暴露到公网

启动脚本使用 `127.0.0.1`，意味着只有本机能够访问。除非已经配置身份验证、防火墙和反向代理，否则不应把 `--listen` 改成 `0.0.0.0` 后直接映射到公网。

## 九、最终目录结构

部署完成后的核心目录如下：

```text
D:\minimax H3 local\
├─ .venv\
├─ .hf-cache\
├─ ComfyUI\
│  ├─ models\
│  └─ output\video\
├─ download-h3-models.ps1
├─ start-h3.ps1
├─ comfyui.log
└─ comfyui-error.log
```

虚拟环境、程序源码、模型、缓存、输出和日志全部集中在同一个工作目录中。以后需要迁移或清理时，边界比较清楚。

## 十、总结

今天的部署过程可以概括为：先检查硬件与磁盘，再安装官方 ComfyUI；创建独立 Python 环境后验证 CUDA；下载主模型、文本编码器、两个 VAE 和 Turbo LoRA；最后用低显存参数启动，在浏览器中加载官方工作流并生成第一段视频。

这次最大的收获不是记住某一条命令，而是确认了本地大模型部署的正确排错顺序：

```text
硬件与空间
    ↓
Python 与依赖
    ↓
CUDA 是否可用
    ↓
模型文件是否完整
    ↓
服务能否启动
    ↓
最小工作流能否生成
    ↓
再逐步提高分辨率与时长
```

按这个顺序，每一步都有明确的检查点。即使中途失败，也能快速判断问题属于环境、下载、显存还是工作流，而不必把整个安装过程推倒重来。
