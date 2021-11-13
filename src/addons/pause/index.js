export default function (scaffolding) {
  // This file is based on the `pause` addon from Scratch Addons
  // All major portions of this file were written by me, so the GPL does not apply

  const vm = scaffolding.vm;

  let paused = false;
  let pausedThreadState = new WeakMap();

  const setPaused = (_paused) => {
    paused = _paused;

    if (paused) {
      vm.runtime.audioEngine.audioContext.suspend();
      if (!vm.runtime.ioDevices.clock._paused) {
        vm.runtime.ioDevices.clock.pause();
      }

      for (const thread of vm.runtime.threads) {
        if (!thread.updateMonitor && !pausedThreadState.has(thread)) {
          const pauseState = {
            pauseTime: vm.runtime.currentMSecs,
            status: thread.status,
          };
          pausedThreadState.set(thread, pauseState);
          // Make sure that paused threads will always be paused.
          // Setting thread.status is not enough for blocks like "ask and wait"
          Object.defineProperty(thread, "status", {
            get() {
              return /* STATUS_PROMISE_WAIT */ 1;
            },
            set(status) {
              // Status will be set when the thread is unpaused.
              pauseState.status = status;
            },
            configurable: true,
            enumerable: true,
          });
        }
      }

      // Immediately emit project stop
      // Scratch will do this automatically, but there may be a slight delay.
      vm.runtime.emit("PROJECT_RUN_STOP");
    } else {
      vm.runtime.audioEngine.audioContext.resume();
      vm.runtime.ioDevices.clock.resume();

      const now = Date.now();
      for (const thread of vm.runtime.threads) {
        const pauseState = pausedThreadState.get(thread);
        if (pauseState) {
          const stackFrame = thread.peekStackFrame();
          if (stackFrame && stackFrame.executionContext && stackFrame.executionContext.timer) {
            const dt = now - pauseState.pauseTime;
            stackFrame.executionContext.timer.startTime += dt;
          }
          // Compiler state is stored differently
          if (thread.timer) {
            const dt = now - pauseState.pauseTime;
            thread.timer.startTime += dt;
          }
          Object.defineProperty(thread, "status", {
            value: pauseState.status,
            configurable: true,
            enumerable: true,
            writable: true,
          });
        }
      }
      pausedThreadState = new WeakMap();
    }

    vm.emit('P4_PAUSE', paused);
  };

  const originalGreenFlag = vm.runtime.greenFlag;
  vm.runtime.greenFlag = function () {
    setPaused(false);
    return originalGreenFlag.call(this);
  };

  // Disable edge-activated hats and hats like "when key pressed" while paused.
  const originalStartHats = vm.runtime.startHats;
  vm.runtime.startHats = function (...args) {
    if (paused) {
      return [];
    }
    return originalStartHats.apply(this, args);
  };

  // Paused threads should not be counted as running when updating GUI state.
  const originalGetMonitorThreadCount = vm.runtime._getMonitorThreadCount;
  vm.runtime._getMonitorThreadCount = function (threads) {
    let count = originalGetMonitorThreadCount.call(this, threads);
    if (paused) {
      for (const thread of threads) {
        if (pausedThreadState.has(thread)) {
          count++;
        }
      }
    }
    return count;
  };

  vm.setPaused = setPaused;
}