const targetLib = "libmsaoaidsec.so";
let alreadyHook = false;
let classFactory = null;

function main() {
  const adeAddr = Module.findExportByName(null, "android_dlopen_ext");
  Interceptor.attach(adeAddr, {
    onEnter: function (args) {
      const pathptr = args[0];
      if (pathptr) {
        const path = ptr(pathptr).readCString();
        // 分析前先打开
        // console.log("[dylib open]: ", path);

        if (path.includes(targetLib)) {
          this.isTarget = true;
          hook_init_proc();
        }
      }
    },
    onLeave: function () {
      if (this.isTarget) {
        const jniOnload = Module.findExportByName(targetLib, "JNI_OnLoad");
        console.log("[hit JNI_OnLoad]: " + jniOnload);
        // 如果有输出的话 说明检测点在JNI_OnLoad之中或者之后
        // 否则可能在.init_proc .init_array .init_xxx等函数中
        Interceptor.attach(jniOnload, {
          onEnter: function (_args) {
            // 其中有检测是否有java层hook
            // hook后 & 0x80000 != 0
            console.log("[func invoke]: JNI_OnLoad");
          },
          onLeave: function () {
            if (Java.available) {
              Java.perform(doJavaHook);
            }
          },
        });
      }
    },
  });
}

function doJavaHook() {
  const Application = Java.use("android.app.Application");
  Application.attach.overload("android.content.Context").implementation = function (context) {
    this.attach(context);
    const classLoader = context.getClassLoader();
    classFactory = Java.ClassFactory.get(classLoader);
  };
  if (classFactory) {
    console.log("[with shell]");
  } else {
    classFactory = Java;
    console.log("[without shell]");
  }
}

function hook_init_proc() {
  const linker = (Process.pointerSize == 8) ? Process.findModuleByName("linker64") : Process.findModuleByName("linker");
  if (linker) {
    // hook call_constructors 函数
    const symbols = linker.enumerateSymbols();
    for (const symbol of symbols) {
      if (symbol.name.includes("call_constructors")) {
        Interceptor.attach(symbol.address, {
          onEnter: function (_args) {
            if (!alreadyHook) {
              const targetSo = Process.findModuleByName(targetLib);
              if (targetSo) {
                hook_before_init_proc(targetSo);
                alreadyHook = true;
              }
            }
          }
        });
        break;
      }
    }
  }
}

function hook_before_init_proc(targetSo) {
  const baseAddr = targetSo.base;
  console.log("targetSo.base: " + baseAddr);

  // 获取函数hook之前的前8个字节
  // const xxxPtr = Module.findExportByName("libc.so", "xxx");
  // console.log(`access first 8 bytes before hook: ${hexdump(xxxPtr, {
  //   offset: 0,
  //   length: 8,
  //   header: true,
  //   ansi: true
  // })}`);

  // 分析前先注释掉这里
  nop(baseAddr, 0x1C544);
  nop(baseAddr, 0x1B8D4);
  nop(baseAddr, 0x26E5C);

  generalBypassHook();

  // 分析前先打开这里 注释掉上面
  // hook pthread_create 函数
  // Interceptor.attach(Module.findExportByName("libc.so", "pthread_create"), {
  //   onEnter(args) {
  //     const threadFuncAddr = args[2];
  //     console.log("The thread function address is " + ptr(threadFuncAddr).sub(baseAddr));
  //   }
  // });

  /*
  [dylib open]:  /system/framework/oat/arm64/org.apache.http.legacy.odex
  [dylib open]:  /data/app/~~Hu9R_ySuFoCUOt4uZED-ig==/cn.soulapp.android-V18oODwiM_xA47Z6dBWmaQ==/oat/arm64/base.odex
  [dylib open]:  /data/app/~~Hu9R_ySuFoCUOt4uZED-ig==/cn.soulapp.android-V18oODwiM_xA47Z6dBWmaQ==/lib/arm64/libmmkv.so
  [dylib open]:  /data/app/~~Hu9R_ySuFoCUOt4uZED-ig==/cn.soulapp.android-V18oODwiM_xA47Z6dBWmaQ==/lib/arm64/libsoul-analytics.so
  [dylib open]:  /data/app/~~Hu9R_ySuFoCUOt4uZED-ig==/cn.soulapp.android-V18oODwiM_xA47Z6dBWmaQ==/lib/arm64/libapminsighta.so
  [dylib open]:  /data/app/~~Hu9R_ySuFoCUOt4uZED-ig==/cn.soulapp.android-V18oODwiM_xA47Z6dBWmaQ==/lib/arm64/libfdsan.so
  [dylib open]:  /data/app/~~Hu9R_ySuFoCUOt4uZED-ig==/cn.soulapp.android-V18oODwiM_xA47Z6dBWmaQ==/lib/arm64/libvolc_log.so
  [dylib open]:  /data/app/~~Hu9R_ySuFoCUOt4uZED-ig==/cn.soulapp.android-V18oODwiM_xA47Z6dBWmaQ==/lib/arm64/libmsaoaidsec.so
  targetSo.base: 0x787018f000
  The thread function address is 0x78701ab544     // sub_1C544
  The thread function address is 0x78701aa8d4     // sub_1B8D4
  The thread function address is 0x78701b5e5c     // sub_26E5C
  */
}


function nop(base, offset) {
  Interceptor.replace(base.add(offset), new NativeCallback(function () {
    console.log(`thread func sub_${offset.toString(16).toUpperCase()} noped`)
  }, 'void', []));
}

function generalBypassHook() {
  // hook fgets 函数
  const fgetsPtr = Module.findExportByName("libc.so", 'fgets');
  const fgets = new NativeFunction(fgetsPtr, 'pointer', ['pointer', 'int', 'pointer']);
  Interceptor.replace(fgetsPtr, new NativeCallback(function (buffer, size, fp) {
    const retval = fgets(buffer, size, fp);
    const bufstr = Memory.readUtf8String(buffer);
    if (bufstr.includes("TracerPid:")) {
      Memory.writeUtf8String(buffer, "TracerPid:\t0");
      console.log("tracerpid replaced: " + Memory.readUtf8String(buffer));
    }
    return retval;
  }, 'pointer', ['pointer', 'int', 'pointer']));

  // hook strstr 函数
  const strstrPtr = Module.findExportByName("libc.so", 'strstr');
  Interceptor.attach(strstrPtr, {
    onEnter: function (args) {
      const keyWord = args[1].readCString();
      if (
        keyWord.includes("frida") ||
        keyWord.includes(":69A2") ||
        keyWord.includes("gum-js") ||
        keyWord.includes("REJECT") ||
        keyWord.includes("gmain") ||
        keyWord.includes("gdbus") ||
        keyWord.includes("linjector")
      ) {
        this.isCheck = true;
      }
    },
    onLeave: function (retval) {
      if (this.isCheck) {
        retval.replace(0);
      }
    }
  });

  // hook access 函数
  const accessPtr = Module.findExportByName("libc.so", 'access');
  Interceptor.attach(accessPtr, {
    onEnter: function (args) {
      const path = args[0].readCString();
      if (
        path.includes("re.frida.server") ||
        path.includes("/data/local/tmp")
      ) {
        this.isCheck = true;
      }
    },
    onLeave: function (retval) {
      if (this.isCheck) {
        retval.replace(-1);
      }
    },
  });
}

setImmediate(main);
