// 京价保
var observeDOM = (function () {
  var MutationObserver = window.MutationObserver || window.WebKitMutationObserver,
    eventListenerSupported = window.addEventListener;

  return function (obj, callback) {
    if (MutationObserver) {
      // define a new observer
      var obs = new MutationObserver(function (mutations, observer) {
        if (mutations[0].addedNodes.length || mutations[0].removedNodes.length)
          callback();
      });
      // have the observer observe foo for changes in children
      obs.observe(obj, { childList: true, subtree: true });
    }
    else if (eventListenerSupported) {
      obj.addEventListener('DOMNodeInserted', callback, false);
      obj.addEventListener('DOMNodeRemoved', callback, false);
    }
  };
})();

function injectScript(file, node) {
  var th = document.getElementsByTagName(node)[0];
  var s = document.createElement('script');
  s.setAttribute('type', 'text/javascript');
  s.setAttribute('charset', "UTF-8");
  s.setAttribute('src', file);
  th.appendChild(s);
}

function injectScriptCode(code, node) {
  var th = document.getElementsByTagName(node)[0];
  var script = document.createElement('script');
  script.setAttribute('type', 'text/javascript');
  script.setAttribute('language', 'JavaScript');
  script.textContent = code;
  th.appendChild(script);
}

injectScriptCode(`
  if (typeof hrl != 'undefined' && typeof host != 'undefined') {
    document.write('<a style="display:none" href="' + hrl + '" id="exe"></a>');
    document.getElementById('exe').click()
  }
`, 'body')

function escapeSpecialChars(jsonString) {
  return jsonString.replace(/\\n/g, "\\n").replace(/\\'/g, "\\'").replace(/\\"/g, '\\"').replace(/\\&/g, "\\&").replace(/\\r/g, "\\r").replace(/\\t/g, "\\t").replace(/\\b/g, "\\b").replace(/\\f/g, "\\f");
}

async function fetchProductPage(sku) {
  var resp = await fetch('https://item.m.jd.com/product/' + sku + '.html', {
    cache: 'no-cache'
  })
  var page = await resp.text()
  if ($(page)[0] && $(page)[0].id == 'returnurl') {
    var url = $(page)[0].value.replace("http://", "https://")
    var request = new XMLHttpRequest();
    request.open('GET', url, false);
    request.send(null);

    if (request.status === 200) {
      var newData = request.responseText
      request.abort();
      return newData
    } else {
      request.abort();
      throw new Error('GET Error')
    }
  } else {
    return page
  }
}

// 获取价格
async function getNowPrice(sku, setting) {
  var data = null
  try {
    data = await fetchProductPage(sku)
  } catch (e) {
    console.log('fetchProductPage', e)
  }
  
  if (data) {
    let itemInfoRe = new RegExp(/<script>[\r\n\s]+window._itemInfo = \({([\s\S]*)}\);[\r\n\s]+<\/script>[\r\n\s]+<script>/, "m");
    let itemOnlyRe = new RegExp(/<script>[\r\n\s]+window._itemOnly =[\r\n\s]+\({([\s\S]*)}\);[\r\n\s]+window\._isLogin/, "m");

    let itemInfo = itemInfoRe.exec(data)
    let itemOnlyInfo = itemOnlyRe.exec(data)

    let itemOnlyJsonString = itemOnlyInfo ? (itemOnlyInfo[1] ? "{" + itemOnlyInfo[1].replace(/,\s*$/, "") + "}" : null) : null
    let skuJsonString = itemInfo ? (itemInfo[1] ? "{" + itemInfo[1].replace(/,\s*$/, "") + "}" : null) : null

    let itemOnly = itemOnlyJsonString ? JSON.parse(escapeSpecialChars(itemOnlyJsonString)) : null
    let skuInfo = skuJsonString ? JSON.parse(escapeSpecialChars(skuJsonString)) : null

    let product_name = (itemOnly ? itemOnly.item.skuName : null) || $(data).find('#itemName').text() || $(data).find('.title-text').text()
    let normal_price = (skuInfo ? skuInfo.price.p : null) || $(data).find('#jdPrice').val() || $(data).find('#specJdPrice').text()

    let spec_price = ($(data).find('#priceSale').text() ? $(data).find('#priceSale').text().replace(/[^0-9\.-]+/g, "") : null) || $(data).find('#spec_price').text()

    let plus_price = (skuInfo ? skuInfo.price.tpp : null) || $(data).find('#specPlusPrice').text()

    let price = normal_price || spec_price || plus_price

    let pingou_price = ((skuInfo && skuInfo.pingouItem) ? skuInfo.pingouItem.m_bp : null) || ($(data).find('#tuanDecoration .price_warp .price').text() ? $(data).find('#tuanDecoration .price_warp .price').text().replace(/[^0-9\.-]+/g, "") : null || null)
    // 价格追踪
    if (!setting.disable_pricechart) {
      reportPrice(sku, price, plus_price, pingou_price)
    }
   
    if (!product_name) {
      console.error('no product_name')
    }
    console.log(product_name + '最新价格', Number(price), 'Plus 价格', Number(plus_price))

    if (Number(plus_price) > 0 && setting.is_plus) {
      return Number(plus_price)
    }

    return Number(price)
  } else {
    return null
  }
}

async function dealProduct(product, order_info, setting) {
  console.log('dealProduct', product, order_info)
  var success_logs = []
  var product_name = product.find('.item-name .name').text()
  var order_price = Number(product.find('.item-opt .price').text().replace(/[^0-9\.-]+/g, ""))
  var order_sku = product.find('.item-opt .apply').attr('id').split('_')
  var order_quantity =  Number(product.find('.item-name .count').text().trim())
  var order_success_logs = product.next().find('.ajaxFecthState .jb-has-succ').text()
  console.log('发现有效的订单', product_name, order_price)

  if (order_success_logs && typeof order_success_logs == "object") {
    order_success_logs.forEach(function(log) {
      if (log) {
        success_logs.push(log.trim())
      }
    });
  }

  if (typeof order_success_logs == "string") {
    success_logs.push(order_success_logs.trim())
  }

  var new_price = await getNowPrice(order_sku[2], setting)
  console.log(product_name + '进行价格对比:', new_price, ' Vs ', order_price)
  order_info.goods.push({
    sku: order_sku[2],
    name: product_name,
    order_price: order_price,
    new_price: new_price,
    success_log: success_logs,
    quantity: order_quantity
  })
  var applyBtn = $(product).find('.item-opt .apply')
  var applyId = applyBtn.attr('id')
  var lastApplyPrice = localStorage.getItem('jjb_order_' + applyId)
  if (new_price > 0 && new_price < order_price && (order_price - new_price) > setting.pro_min ) {
    if (lastApplyPrice && Number(lastApplyPrice) <= new_price) {
      console.log('Pass: ' + product_name + '当前价格上次已经申请过了:', new_price, ' Vs ', lastApplyPrice)
      return 
    }
    // 如果禁止了自动申请
    if (setting.prompt_only) {
      localStorage.setItem('jjb_order_' + applyId, new_price)
      chrome.runtime.sendMessage({
        text: "notice",
        batch: 'jiabao',
        title: '报告老板，发现价格保护机会！',
        product_name: product_name,
        content: '购买价：'+ order_price + ' 现价：' + new_price + '，请手动提交价保申请。'
      }, function(response) {
        console.log("Response: ", response);
      });
    } else {
      // 申请
      applyBtn.trigger( "click" )
      localStorage.setItem('jjb_order_' + applyId, new_price)
      chrome.runtime.sendMessage({
        text: "notice",
        batch: 'jiabao',
        title: '报告老板，发现价格保护机会！',
        product_name: product_name,
        content: '购买价：'+ order_price + ' 现价：' + new_price + '，已经自动提交价保申请，正在等待申请结果。'
      }, function(response) {
        console.log("Response: ", response);
      });
      // 等待15秒后检查申请结果
      var resultId = "applyResult_" + applyId.substr(8)
      setTimeout(function () {
        observeDOM(document.getElementById(resultId), function () {
          let resultText = $("#" + resultId).text()
          if (resultText && resultText.indexOf("预计") < 0) {
            chrome.runtime.sendMessage({
              batch: 'jiabao',
              text: "notice",
              title: "报告老板，价保申请有结果了",
              product_name: product_name,
              content: "价保结果：" + resultText
            }, function (response) {
              console.log("Response: ", response);
            });
          }
        });
      }, 5000)
    }
  }
}

async function dealOrder(order, orders, setting) {
  var dealgoods = []
  var order_time = new Date(order.find('.title span').last().text().trim().split('：')[1])
  var order_id = order.find('.title .order-code').text().trim().split('：')[1]
  console.log('订单:', order_id, order_time, setting)

  var proTime = 15 * 24 * 3600 * 1000
  if (setting.pro_days == '7') {
    proTime = 7 * 24 * 3600 * 1000
  }
  if (setting.pro_days == '30') {
    proTime = 30 * 24 * 3600 * 1000
  }

  // 如果订单时间在设置的价保监控范围以内
  if (new Date().getTime() - order_time.getTime() < proTime) {
    var order_info = {
      time: order_time,
      goods: []
    }

    order.find('.product-item').each(function() {
      dealgoods.push(dealProduct($(this), order_info, setting))
    })

    await Promise.all(dealgoods)
    console.log('order_info', order_info)
    orders.push(order_info)
  }
}

async function getAllOrders(setting) {
  console.log('京价保开始自动检查订单')
  let orders = []
  let dealorders = []
  $( "#dataList0 li" ).each(function() {
    dealorders.push(dealOrder($(this), orders, setting))
  });
  await Promise.all(dealorders)
  chrome.runtime.sendMessage({
    text: "orders",
    content: JSON.stringify(orders)
  }, function(response) {
    console.log("Response: ", response);
  });
  localStorage.setItem('jjb_last_check', new Date().getTime());
}

var auto_login_html = "<p class='auto_login'><span class='jjb-login'>让京价保记住密码并自动登录</span></p>";


function mockClick(element) {
  // DOM 2 Events
  var dispatchMouseEvent = function (target, var_args) {
    var e = document.createEvent("MouseEvents");
    // If you need clientX, clientY, etc., you can call
    // initMouseEvent instead of initEvent
    e.initEvent.apply(e, Array.prototype.slice.call(arguments, 1));
    target.dispatchEvent(e);
  };
  dispatchMouseEvent(element, 'mouseover', true, true);
  dispatchMouseEvent(element, 'mousedown', true, true);
  dispatchMouseEvent(element, 'click', true, true);
  dispatchMouseEvent(element, 'mouseup', true, true);
}

/* eventType is 'touchstart', 'touchmove', 'touchend'... */
function sendTouchEvent(x, y, element, eventType) {
  const touchObj = new Touch({
    identifier: Date.now(),
    target: element,
    clientX: x,
    clientY: y,
    radiusX: 2.5,
    radiusY: 2.5,
    rotationAngle: 10,
    force: 0.5,
  });

  if ('TouchEvent' in window && TouchEvent.length > 0) {
    const touchEvent = new TouchEvent(eventType, {
      cancelable: true,
      bubbles: true,
      touches: [touchObj],
      targetTouches: [],
      changedTouches: [touchObj],
      shiftKey: true,
    });
    element.dispatchEvent(touchEvent);
  } else {
    console.log('no TouchEvent')
  }

}


// 4：领取白条券
function CheckBaitiaoCouponDom(setting) {
  if (setting != 'never') {
    console.log('开始领取白条券')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "4"
    })
    var time = 0;
    $("#react-root .react-root .react-view .react-view .react-view .react-view .react-view .react-view .react-view span").each(function () {
      let targetEle = $(this)
      if (targetEle.text() == '立即领取') {
        let couponDetails = targetEle.parent().prev().find('span').toArray()
        console.log(couponDetails)
        var coupon_name = couponDetails[2] ? $(couponDetails[2]).text().trim() : '未知白条券'
        var coupon_price = couponDetails[0] ? $(couponDetails[0]).text().trim(): '？' + (couponDetails[1] ? (' (' + $(couponDetails[1]).text() + ')') : '')
        setTimeout(function () {
          mockClick(targetEle[0])
          setTimeout(function () {
            if (targetEle.text() == '去查看') {
              chrome.runtime.sendMessage({
                text: "coupon",
                title: "京价保自动领到一张白条优惠券",
                content: JSON.stringify({
                  batch: 'baitiao',
                  price: coupon_price,
                  name: coupon_name
                })
              }, function (response) {
                console.log("Response: ", response);
              });
            }
          }, 500)
        }, time)
        time += 5000;
      }
    })
  }
}

// 保存账号
function saveAccount(account) {
  chrome.runtime.sendMessage({
    text: "saveAccount",
    content: JSON.stringify(account)
  }, function (response) {
    console.log('saveAccount response', response)
  });
}

// 获取账号信息
function getAccount(type) {
  console.log("getAccount", type)
  chrome.runtime.sendMessage({
    text: "getAccount",
    type: type
  },
  function (account) {
    if (account && account.username && account.password) {
      setTimeout(() => {
        autoLogin(account, type)
      }, 50);
    } else {
      chrome.runtime.sendMessage({
        text: "loginState",
        state: "failed",
        message: "由于账号未保存无法自动登录",
        type: type
      }, function (response) {
        console.log("Response: ", response);
      });
    }
  });
}
// 获取设置
function getSetting(name, cb) {
  chrome.runtime.sendMessage({
    text: "getSetting",
    content: name
  }, function (response) {
    cb(response)
    console.log("getSetting Response: ", response);
  });
}

// 登录失败
function dealLoginFailed(type, errormsg) {
  let loginFailedDetail = {
    text: "loginFailed",
    type: type,
    notice: true,
    content: errormsg
  }
  // 如果是单纯的登录页面，则不发送浏览器提醒
  if (window.location.href == "https://plogin.m.jd.com/user/login.action?appid=100" || window.location.href == "https://passport.jd.com/uc/login") {
    loginFailedDetail.notice = false
    console.log("主动登录页面不发送浏览器消息提醒")
  }
  chrome.runtime.sendMessage(loginFailedDetail, function (response) {
    console.log("loginFailed Response: ", response);
  });
}

// 自动登录
function autoLogin(account, type) {
  console.log('京价保正在为您自动登录', type)
  if (type == 'pc') {
    // 切换到账号登录
    mockClick($(".login-tab-r a")[0])
    // 自动补全填入
    $("#loginname").val(account.username)
    $("#nloginpwd").val(account.password)
    // 监控验证结果
    let authcodeDom = document.getElementById("s-authcode")
    if (authcodeDom) {
      observeDOM(authcodeDom, function () {
        let resultText = $("#s-authcode .authcode-btn").text()
        if (resultText && resultText == "验证成功") {
          mockClick($(".login-btn a")[0])
        }
      });
    }
    // 如果此前已经登录失败
    if (account.loginState && account.loginState.state == 'failed') {
      $(".tips-inner .cont-wrapper p").text('由于在' + account.loginState.displayTime + '自动登录失败（原因：' + account.loginState.message + '），京价保暂停自动登录').css('color', '#f73535').css('font-size', '14px')
      $(".login-wrap .tips-wrapper").hide()
      $("#content .tips-wrapper").css('background', '#fff97a')
      chrome.runtime.sendMessage({
        text: "highlightTab",
        content: JSON.stringify({
          url: window.location.href,
          pinned: "true"
        })
      }, function (response) {
        console.log("Response: ", response);
      });  
    } else {
      // 如果显示需要验证
      if ($("#s-authcode").height() > 0) {
        dealLoginFailed("pc", "需要完成登录验证")
      } else {
        setTimeout(function () {
          mockClick($(".login-btn a")[0])
        }, 500)
        // 监控登录失败
        setTimeout(function () {
          let errormsg = $('.login-box .msg-error').text()
          dealLoginFailed("pc", errormsg)
        }, 1500)
      }
    }
  // 手机登录
  } else {
    $("#username").val(account.username)
    $("#password").val(account.password)
    $("#loginBtn").addClass("btn-active")
    if ($("#input-code").height() > 0) {
      dealLoginFailed("m", "需要完成登录验证")
    } else {
      setTimeout(function () {
        if ($("#username").val() && $("#password").val()) {
          mockClick($("#loginBtn")[0])
        }
      }, 500)
    }
  }
}


// 转存老的账号
function resaveAccount() {
  var jjb_username = localStorage.getItem('jjb_username')
  var jjb_password = localStorage.getItem('jjb_password')
  if (jjb_username && jjb_password) {
    localStorage.removeItem('jjb_username')
    localStorage.removeItem('jjb_password')
    saveAccount({
      username: jjb_username,
      password: jjb_password
    })
  }
}


// 3：领取 PLUS 券
function getPlusCoupon(setting) {
  if (setting != 'never') {
    var time = 0;
    console.log('开始领取 PLUS 券')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "3"
    })
    $(".coupon-swiper .coupon-item").each(function () {
      var that = $(this)
      if ($(this).find('.get-btn').text() == '立即领取') {
        var coupon_name = that.find('.pin-lmt').text()
        var coupon_price = that.find('.cp-val').text() + '元 (' + that.find('.cp-lmt').text() + ')'
        setTimeout(function () {
          $(that).find('.get-btn').trigger("click")
          chrome.runtime.sendMessage({
            text: "coupon",
            title: "京价保自动领到一张 PLUS 优惠券",
            content: JSON.stringify({
              id: '',
              batch: '',
              price: coupon_price,
              name: coupon_name
            })
          }, function (response) {
            console.log("Response: ", response);
          });
        }, time)
        time += 5000;
      }
    })
  }
}

// 15：领取全品类券
function getCommonUseCoupon(setting) {
  if (setting != 'never') {
    var time = 0;
    console.log('开始领取全品类券')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "15"
    })
    $("#quanlist .quan-item").each(function () {
      var that = $(this)
      if (that.find('.q-ops-box .q-opbtns .txt').text() == '立即领取' && that.find('.q-range').text().indexOf("全品类通用") > -1) {
        var coupon_name = that.find('.q-range').text()
        var coupon_price = that.find('.q-price strong').text() + '元 (' + that.find('.q-limit').text() + ')'
        setTimeout(function () {
          $(that).find('.btn-def').trigger("click")
          setTimeout(function () {
            if ($(that).find('.q-ops-jump .geted-site').css('display') !== 'none') {
              chrome.runtime.sendMessage({
                text: "coupon",
                title: "京价保自动领到一张全品类优惠券",
                content: JSON.stringify({
                  id: '',
                  batch: '',
                  price: coupon_price,
                  name: coupon_name
                })
              }, function (response) {
                console.log("Response: ", response);
              });
            }
          }, 1500)
        }, time)
        time += 5000;
      }
    })
  }
}

// 自动浏览店铺（7：店铺签到）
function autoVisitShop(setting) {
  if (setting != 'never') {
    console.log('开始自动访问店铺领京豆')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "7"
    })
    var time = 0;
    $(".bean-shop-list li").each(function () {
      var that = $(this)
      if ($(that).find('.s-btn').text() == '去签到') {
        setTimeout(function () {
          chrome.runtime.sendMessage({
            text: "create_tab",
            batch: "bean",
            content: JSON.stringify({
              index: 0,
              url: $(that).find('.s-btn').attr('href'),
              active: "false",
              pinned: "true"
            })
          }, function (response) {
            console.log("Response: ", response);
          });
        }, time)
        time += 30000;
      }
    })
  }
}

// 店铺签到（7：店铺签到）
function doShopSign(setting) {
  if (setting != 'never') {
    console.log('店铺自动签到')
    chrome.runtime.sendMessage({ text: "myTab" }, function (result) {
      console.log('tab', result.tab)
      if (result.tab.pinned) {
        if ($(".j-unsigned.j-sign").length > 0 && $(".j-unsigned.j-sign").attr("status") == 'true') {
          $('.j-unsigned.j-sign').trigger("click")
        } else {
          setTimeout(function () {
            $('.jSign .unsigned').trigger("click")
            $('.jSign .unsigned').trigger("tap")
          }, 3000)
        }
      } else {
        console.log('正常访问不执行店铺自动签到')
      }
    });
  }
}

// 10：金融铂金会员返利
function getRebate(setting) {
  if (setting != 'never') {
    console.log('京东金融铂金会员返利')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "10"
    })
    // 切换到支付返现视图
    $("#react-root .react-root .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view span").each(function () {
      let targetEle = $(this)
      if (targetEle.text() == '支付返现') {
        mockClick(targetEle[0])
        setTimeout(() => {
          getPlatinumRebate()
        }, 500);
      }
    })
    // 领取返利
    function getPlatinumRebate() {
      let time = 0;
      $("#react-root .react-root .react-view img").each(function () {
        let that = $(this)
        if (that.attr("src") && that.width() > 40) {
          setTimeout(function () {
            mockClick(that[0])
            let amount = that.parent().parent().prev().find('span').last().text()
            if (amount && amount > 0.1) {
              let content = "应该是领到了" + amount + '元的返利。'
              if (amount > 5) {
                content += "求打赏"
              }
              chrome.runtime.sendMessage({
                text: "notice",
                batch: "rebate",
                value: amount,
                unit: 'cash',
                title: "京价保自动为您领取铂金会员支付返利",
                content: content
              }, function (response) {
                console.log("Response: ", response);
              });
            }
          }, time)
          time += 5000;
        }
      })
    }
  }
}

// 移动页领取优惠券（2：领精选券）
function pickupCoupon(setting) {
  if (setting != 'never') {
    let time = 0;
    console.log('开始领取精选券')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "2"
    })
    $(".coupon_sec_body a.coupon_default").each(function () {
      let that = $(this)
      let coupon_name = that.find('.coupon_default_name').text()
      let coupon_id = that.find("input[class=id]").val()
      let coupon_price = that.find('.coupon_default_price').text()
      if (that.find('.coupon_default_des').text()) {
        coupon_price = that.find('.coupon_default_des').text()
      }
      if ($(this).find('.coupon_default_status_icon').text() == '立即领取') {
        setTimeout(function () {
          mockClick($(that).find('.coupon_default_status_icon')[0])
          setTimeout(function () {
            if ($(that).find('.coupon_default_status_icon').text() == '立即使用') {
              chrome.runtime.sendMessage({
                text: "coupon",
                title: "京价保自动领到一张新的优惠券",
                content: JSON.stringify({
                  id: coupon_id,
                  price: coupon_price,
                  name: coupon_name
                })
              }, function (response) {
                console.log("Response: ", response);
              });
            }
          }, 500)
        }, time)
        time += 5000;
      }
    })
  }
}

// 14: 钢镚签到
function getCoin(setting) {
  if (setting != 'never') {
    console.log('钢镚签到')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "14"
    })
    if ($("#myCanvas").length > 0) {
      let canvas = $("#myCanvas")[0]
      let rect = canvas.getBoundingClientRect()
      let startX = rect.left * (canvas.width / rect.width)
      
      sendTouchEvent(startX + 10, rect.y + 10, canvas, 'touchstart');
      sendTouchEvent(startX + 70, rect.y + 10, canvas, 'touchmove');
      sendTouchEvent(startX + 70, rect.y + 10, canvas, 'touchend');

      // 监控结果
      setTimeout(function () {
        if (($('.popup_reward_container .popup_gb_line').text() && $(".popup_reward_container .popup_gb_line").text().indexOf("获得") > -1)) {
          let re = /^[^-0-9.]+([0-9.]+)[^0-9.]+$/
          let rawValue = $(".popup_reward_container .popup_gb_line").text()
          let value = re.exec(rawValue)
          markCheckinStatus('coin', value[1] + '个钢镚', () => {
            chrome.runtime.sendMessage({
              text: "checkin_notice",
              title: "京价保自动为您签到抢钢镚",
              value: value[1],
              unit: 'coin',
              content: "恭喜您领到了" + value[1] + "个钢镚"
            }, function (response) {
              console.log("Response: ", response);
            })
          })
        }
      }, 1000)
    } else {
      markCheckinStatus('coin')
    }
  }
}

// 1: 价格保护
function priceProtect(setting) {
  if (setting != 'never') {
    // try getListData
    var objDiv = document.getElementById("mescroll0");
    objDiv.scrollTop = (objDiv.scrollHeight * 2);

    weui.toast('京价保运行中', 1000);

    if ($(".bd-product-list li").length > 0) {
      console.log('成功获取价格保护商品列表', new Date())
      chrome.runtime.sendMessage({
        text: "run_status",
        jobId: "1"
      })
      chrome.runtime.sendMessage({
        text: "getPriceProtectionSetting"
      }, function (response) {
        setTimeout(function () {
          getAllOrders(response)
        }, 5000)
        console.log("getPriceProtectionSetting Response: ", response);
      });
    } else {
      console.log('好尴尬，最近没有买东西..', new Date())
    }
  }
}

// 从京东热卖自动跳转到商品页面
function autoGobuy(setting) {
  injectScript(chrome.extension.getURL('/static/dialog-polyfill.js'), 'body');
  // 拼接提示
  let dialogMsgDOM = `<dialog id="dialogMsg" class="message">` +
    `<p class="green-text">京价保已自动为你跳转到商品页面</p>` +
    `<p class="tips">打开京价保进入其他设置可关闭此功能</p>` +
    `</dialog>`
  // 写入提示消息
  $("body").append(dialogMsgDOM);

  if (setting == "checked") {
    setTimeout(() => {
      let dialogMsg = document.getElementById('dialogMsg');
      dialogMsg.showModal();
    }, 50);
    mockClick($(".shop_intro .gobuy a")[0])
  }  
}

// 报告价格
function reportPrice(sku, price, plus_price, pingou_price) {
  $.ajax({
    method: "POST",
    type: "POST",
    url: "https://jjb.zaoshu.so/price",
    data: {
      sku: sku,
      price: Number(price),
      plus_price: plus_price ? Number(plus_price) : null,
      pingou_price: pingou_price ? Number(pingou_price) : null,
    },
    timeout: 3000,
    dataType: "json"
  })
}

// 价格历史
function showPriceChart(disable) {
  if (disable == "checked") {
    console.log('价格走势图已禁用')
  } else {
    injectScript(chrome.extension.getURL('/static/priceChart.js'), 'body');
    injectScriptCode(`
      setTimeout(() => {
        $("#disablePriceChart").attr("extensionId", "${chrome.runtime.id}")
      }, 1500);
    `, 'body')
    setTimeout(() => {
      let urlInfo = /(https|http):\/\/item.jd.com\/([0-9]*).html/g.exec(window.location.href);
      let sku = urlInfo[2]
      let price = $('.p-price .price').text().replace(/[^0-9\.-]+/g, "")
      let plus_price = $('.p-price-plus .price').text().replace(/[^0-9\.-]+/g, "")
      let pingou_price = null
      if ($('#pingou-banner-new') && $('#pingou-banner-new').length > 0 && ($('#pingou-banner-new').css('display') !== 'none')) {
        pingou_price = ($(".btn-pingou span").first().text() ? $(".btn-pingou span").first().text().replace(/[^0-9\.-]+/g, "") : null) || price
        price = $("#InitCartUrl span").text() ? $("#InitCartUrl span").text().replace(/[^0-9\.-]+/g, "") : price
      }
      reportPrice(sku, price, plus_price, pingou_price)
    }, 1000);
  }
}

// 剁手保护模式
function handProtection(setting) {
  if (setting == "checked") {
    injectScript(chrome.extension.getURL('/static/dialog-polyfill.js'), 'body');
    let url = $("#InitCartUrl").attr("href")
    let item = $(".ellipsis").text()
    let price = $(".summary-price-wrap .p-price").text()
    // 拼接提示
    let dialogMsgDOM = `<dialog id="dialogMsg" class="message">` +
      `<p class="green-text">恭喜你省下了 ` + price + ` ！</p>` +
      `</dialog>`
    // 写入提示消息
    $("body").append(dialogMsgDOM);

    $("#InitCartUrl").data("url", url)
    $("#InitCartUrl").removeAttr("clstag")
    $("#InitCartUrl").on("click", function () {
      let count = $('#buy-num').val()
      // 移除此前的提示
      if ($("#dialog").size() > 0) {
        $("#dialog").remove()
      }
      // 拼接提示
      let dialogDOM = `<dialog id="dialog">` +
        `<span class="close">x</span>` +
        `<form method="dialog">` +
        `<h3>你真的需要买` + (Number(count) > 1 ? count + '个' : '') + item + `吗?</h3>` +
        `<div class="consideration">` +
        `<p>它是必须的吗？使用的频率足够高吗？</p>` +
        `<p>它真的可以解决你的需求吗？现有方案完全无法接受吗？</p>` +
        `<p>如果收到不合适，它在试用之后退款方便吗？</p>` +
        `<p>现在购买它的价格 ` + price + ` 合适吗？</p>` +
        (Number(count) > 1 ? `<p>有必要现在购买 ` + count + `个吗？</p>` : '') +
        `</div>` +
        `<div class="actions">` +
        `<a href="` + url + `" class="volume-purchase forcedbuy" target="_blank">坚持购买</a>` +
        `<button type="submit" value="no" class="giveUp btn-special2 btn-lg" autofocus>一键省钱</button>` +
        `</div>` +
        `<p class="admonish">若无必要，勿增实体</p>` +
        `</form>` +
        `</dialog>`
      // 写入提示
      $("body").append(dialogDOM);
      var dialog = document.getElementById('dialog');
      var dialogMsg = document.getElementById('dialogMsg');

      dialog.showModal();
      document.querySelector('#dialog .close').onclick = function () {
        dialog.close();
      };

      document.querySelector('#dialog .giveUp').onclick = function () {
        dialog.close();
        setTimeout(() => {
          dialogMsg.showModal();
        }, 50);
        setTimeout(() => {
          dialogMsg.close();
          if (confirm("京价保剁手保护模式准备帮你关闭这个标签页，确认要关闭吗?")) {
            window.close();
          }
        }, 1000);
      };

      return false;
    })
  }
}


function markCheckinStatus(type, value, cb) {
  chrome.runtime.sendMessage({
    text: "checkin_status",
    batch: type,
    value: value,
    status: "signed"
  })
  if (cb) { cb() }
}




// 主体任务
function CheckDom() {
  // 转存账号
  resaveAccount()
  
  // PC 是否登录
  if ($("#ttbar-login .nickname") && $("#ttbar-login .nickname").length > 0) {
    console.log('PC 已经登录')
    chrome.runtime.sendMessage({
      text: "loginState",
      state: "alive",
      message: "PC网页检测到用户名",
      type: "pc"
    }, function(response) {
      console.log("Response: ", response);
    });
  };

  // M 是否登录
  if ($("#mCommonMy") && $("#mCommonMy").length > 0 && $("#mCommonMy").attr("report-eventid") == "MCommonBottom_My") {
    console.log('M 已经登录')
    chrome.runtime.sendMessage({
      text: "loginState",
      state: "alive",
      message: "移动网页检测到登录",
      type: "m"
    }, function(response) {
      console.log("Response: ", response);
    });
  };

  // 是否是PLUS会员
  if ($(".cw-user .fm-icon").size() > 0 && $(".cw-user .fm-icon").text() == '正式会员') {
    chrome.runtime.sendMessage({
      text: "isPlus",
    }, function (response) {
      console.log("Response: ", response);
    });
  }

  // 账号登录
  // 手机版登录页
  if ( $(".loginPage").length > 0 ) {
    getAccount('m')
    $(auto_login_html).insertAfter( ".loginPage .notice" )
    $('.loginPage').on('click', '.jjb-login', function (e) {
      window.event ? window.event.returnValue = false : e.preventDefault();
      var username = $("#username").val()
      var password = $("#password").val()
      // 保存账号和密码
      if (username && password) {
        saveAccount({
          username: username,
          password: password
        })
      }
      mockClick($("#loginBtn")[0])
    })
  };
  // PC版登录页
  if ($(".login-tab-r").length > 0) {
    getAccount('pc')
    $(auto_login_html).insertAfter("#formlogin")
    $('.login-box').on('click', '.jjb-login', function (e) {
      window.event ? window.event.returnValue = false : e.preventDefault();
      var username = $("#loginname").val()
      var password = $("#nloginpwd").val()
      // 保存账号和密码
      if (username && password) {
        saveAccount({
          username: username,
          password: password
        })
      }
      mockClick($(".login-btn a")[0])
    })
  };

  // 移除遮罩
  if ($("#pcprompt-viewpc").size() > 0) {
    mockClick($("#pcprompt-viewpc")[0])
  }

  // 商品页
  if (window.location.host == 'item.jd.com') {
    getSetting('disable_pricechart', showPriceChart);
  }

  // 会员页签到 (5:京东会员签到)
  if ($(".sign-pop").length || $(".signin .signin-days").length) {
    console.log('签到领京豆（vip）')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "5"
    })
    if ($(".sign-pop").hasClass('signed') || $(".signin-desc").text() == '今日已签到 请明日再来') {
      markCheckinStatus('vip')
    } else {
      $(".sign-pop").trigger("tap")
      $(".sign-pop").trigger("click")
      setTimeout(function () {
        if ($(".sign-pop").hasClass('signed')) {
          let value = $(".modal-sign-in .jdnum span").text()
          markCheckinStatus('vip', value + '京豆', () => {
            chrome.runtime.sendMessage({
              text: "checkin_notice",
              batch: "bean",
              value: value,
              unit: 'bean',
              title: "京价保自动为您签到领京豆",
              content: "恭喜您获得了" + value + '个京豆奖励'
            }, function (response) {
              console.log("Response: ", response);
            })
          })
        }
      }, 2000)
    }
  };

  // 双签奖励 (12:双签奖励)
  if ($("#receiveAward .link-gift").length) {
    console.log('双签奖励（double_check）')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "12"
    })
    if ($("#JGiftDialog .gift-dialog-btn").text() == '立即领取') {
      $("#JGiftDialog .gift-dialog-btn").trigger("tap")
      $("#JGiftDialog .gift-dialog-btn").trigger("click")
      setTimeout(function () {
        if ($("#awardInfo .cnt-hd").text() == '你已领取双签礼包') {
          let value = $("#awardInfo .item-desc-1").text().replace(/[^0-9\.-]+/g, "")
          markCheckinStatus('double_check', value + '京豆', () => {
            chrome.runtime.sendMessage({
              text: "checkin_notice",
              batch: "bean",
              value: value,
              unit: 'bean',
              title: "京价保自动为您领取双签礼包",
              content: "恭喜您获得了" + value + '个京豆奖励'
            }, function (response) {
              console.log("Response: ", response);
            })
          })
        }
      }, 2000)
    } else {
      markCheckinStatus('double_check')
    }
  };

  // 13：京东用户每日福利
  if ($(".signDay_day").length) {
    console.log('13：京东用户每日福利')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "13"
    })
    if ($(".day_able .signDay_day_btm").text() == "签到领取") {
      $(".day_able .signDay_day_btm").trigger("tap")
      $(".day_able .signDay_day_btm").trigger("click")
      setTimeout(function () {
        if ($(".day_able .signDay_day_btm").text() == "已签到领取") {
          let value = 1
          markCheckinStatus('vip', value + '京豆', () => {
            chrome.runtime.sendMessage({
              text: "checkin_notice",
              batch: "bean",
              value: value,
              unit: 'bean',
              title: "京价保自动为您签到领京豆",
              content: "恭喜您获得了" + value + '个京豆奖励'
            }, function (response) {
              console.log("Response: ", response);
            })
          })
        }
      }, 2000)
    } else {
      markCheckinStatus('m_welfare')
    }
  };


  // 京豆签到 (11:京豆签到)
  if (window.location.host == 'bean.m.jd.com') {
    console.log('京豆签到（bean）')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "11"
    })
    var beanbtn = null
    $("#m_common_content .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view span").each(function () {
      let targetEle = $(this)
      if (targetEle.text() == '签到领京豆') {
        mockClick(targetEle[0])
        setTimeout(() => {
          if ($("img[src='https://m.360buyimg.com/mobilecms/jfs/t8899/48/1832651162/9481/95d84514/59bfb1c5N176f3f20.png']")[0]) {
            mockClick($("img[src='https://m.360buyimg.com/mobilecms/jfs/t8899/48/1832651162/9481/95d84514/59bfb1c5N176f3f20.png']")[0])
            markCheckinStatus('bean', null, () => {
              chrome.runtime.sendMessage({
                text: "checkin_notice",
                batch: "bean",
                unit: 'bean',
                title: "京价保自动为您签到领京豆",
                content: "恭喜您获得了一两个京豆奖励"
              }, function (response) {
                console.log("Response: ", response);
              })
            })
          }
        }, 500);
      }
    })


    $("#m_common_content .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view .react-view span").each(function () {
      if ($(this).text() == '已连续签到') {
        markCheckinStatus('bean')
      }
    })
  };

  if ( $(".signin-desc em").text() ) {
    let value = $(".signin-desc em").text()
    markCheckinStatus('vip', value + '京豆', () => {
      chrome.runtime.sendMessage({
        text: "checkin_notice",
        batch: "bean",
        value: value,
        unit: 'bean',
        title: "京价保自动为您签到领京豆",
        content: "恭喜您获得了" + value + '个京豆奖励'
      }, function (response) {
        console.log("Response: ", response);
      })
    })
  }

  // 京东金融慧赚钱签到 (6:金融慧赚钱签到)
  if ($(".assets-wrap .gangbeng").size() > 0) {
    console.log('签到领京豆（jr-qyy）')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "6"
    })
    if ($(".gangbeng .btn").text() == "签到") {
      $(".gangbeng .btn").trigger( "tap" )
      $(".gangbeng .btn").trigger( "click" )
      // 监控结果
      setTimeout(function () {
        if (($(".am-modal-body .title").text() && $(".am-modal-body .title").text().indexOf("获得") > -1) ) {
          let re = /^[^-0-9.]+([0-9.]+)[^0-9.]+$/
          let rawValue = $(".am-modal-body .title").text()
          let value = re.exec(rawValue)
          markCheckinStatus('jr-qyy', (value ? value[1] : '一两') + '个钢镚', () => {
            chrome.runtime.sendMessage({
              text: "checkin_notice",
              title: "京价保自动为您签到抢钢镚",
              value: value ? value[1] : 1,
              unit: 'coin',
              content: "恭喜您领到了" + (value ? value[1] : '一两') + "个钢镚"
            }, function(response) {
              console.log("Response: ", response);
            })
          })
        }
      }, 1000)
    } else {
      markCheckinStatus('jr-qyy')
    }
  };

  // 钢镚签到 (14:钢镚签到)
  if (window.location.origin == "https://coin.jd.com" && window.location.pathname == "/m/gb/index.html") {
    injectScriptCode(`
      function canvasEventListener() {
        let canvas = $("#myCanvas")[0];
        canvas.addEventListener('touchstart', canvas.ontouchstart);
        canvas.addEventListener('touchmove', canvas.ontouchmove);
        canvas.addEventListener('touchend', canvas.ontouchend);
      };
      canvasEventListener();
    `, 'body')
    setTimeout(() => {
      getSetting('job14_frequency', getCoin);
    }, 1000);
  };

  // 京东支付签到
  if ( $(".signIn .signInBtn").size() > 0) {
    console.log('签到领京豆（jdpay)')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "8"
    })
    if (!$(".signInBtn").hasClass('clicked')) {
      $(".signInBtn").trigger("tap")
      $(".signInBtn").trigger("click")
      setTimeout(function () {
        if ($(".signInBtn").hasClass('clicked')) {
          let value = $("#rewardTotal").text()
          markCheckinStatus('jdpay', $("#rewardTotal").text() + '个钢镚', () => {
            chrome.runtime.sendMessage({
              text: "checkin_notice",
              unit: 'coin',
              value: value,
              title: "京价保自动为您签到京东支付",
              content: "恭喜您领到了" + value + "个钢镚"
            }, function (response) {
              console.log("Response: ", response);
            })
          })
        }
      }, 1000)
    } else {
      markCheckinStatus('jdpay', $("#rewardTotal").text() + '个钢镚')
    }
  };

  // 京东金融首页签到（9： 金融会员签到）
  if ($(".ban-center .m-qian").size() > 0) {
    console.log('签到领京豆（jr-index)')
    chrome.runtime.sendMessage({
      text: "run_status",
      jobId: "9"
    })
    if ($(".ban-center .m-qian").length > 0 && $(".ban-center .m-qian .qian-text").text() == '签到') {
      $(".ban-center .m-qian .qian-text").trigger("tap")
      $(".ban-center .m-qian .qian-text").trigger("click")
      // 监控结果
      setTimeout(function () {
        if ($(".ban-center .m-qian .qian-text").text() == '已签到' || $("#signFlag").text() == '签到成功' ) {
          let re = /^[^-0-9.]+([0-9.]+)[^0-9.]+$/
          let rawValue = $("#getRewardText").text()
          let value = re.exec(rawValue)
          markCheckinStatus('jr-index', rawValue, () => {
            chrome.runtime.sendMessage({
              text: "checkin_notice",
              title: "京价保自动为您签到京东金融",
              value: value[1],
              unit: 'coin',
              content: "恭喜您！领到了" + value[1] + "个钢镚"
            }, function (response) {
              console.log("Response: ", response);
            })
          })
        }
      }, 1000)
    } else {
      if ($(".ban-center .m-qian .qian-text").text() == '已签到') {
        markCheckinStatus('jr-index')
      }
    }
  };

  // 领取 PLUS 券（3： PLUS券）
  if ( $(".coupon-swiper .coupon-item").length > 0 ) {
    getSetting('job3_frequency', getPlusCoupon)
  };

  // 单独的领券页面
  if ( $("#js_detail .coupon_get") && $(".coupon_get .js_getCoupon").length > 0) {
    console.log('单独的领券页面', $("#js_detail .coupon_get").find('.js_getCoupon'))
    $("#js_detail .coupon_get").find('.js_getCoupon').trigger( "tap" )
    $("#js_detail .coupon_get").find('.js_getCoupon').trigger( "click" )
  }

  // 领取白条券（4：领白条券）
  if ($("#react-root .react-root .react-view").length > 0 && window.location.host == 'm.jr.jd.com' && document.title == "领券中心") {
    getSetting('job4_frequency', CheckBaitiaoCouponDom)
  };

  // 全品类券
  if ($("#quanlist").length > 0 && window.location.host == 'a.jd.com') {
    getSetting('job15_frequency', getCommonUseCoupon)
  };

  // 自动访问店铺领京豆
  if ( $(".bean-shop-list").length > 0 ) {
    getSetting('job7_frequency', autoVisitShop)
  };


  if ($(".jShopHeaderArea").length > 0 && $(".jShopHeaderArea .jSign .unsigned").length > 0) {
    getSetting('job7_frequency', doShopSign)
  }

  if ($(".jShopHeaderArea").length > 0 && $(".jShopHeaderArea .jSign .signed").length > 0) {
    chrome.runtime.sendMessage({
      text: "remove_tab",
      content: JSON.stringify({
        url: window.location.href,
        pinned: "true"
      })
    }, function(response) {
      console.log("Response: ", response);
    });  
  }

  // 领取精选券
  if ($(".coupon_sec_body").length > 0) {
    getSetting('job2_frequency', pickupCoupon)
  };

  // 自动领取京东金融铂金会员京东支付返利（10：金融铂金会员支付返利）
  if ($("#react-root .react-root .react-view").length > 0 && window.location.host == 'm.jr.jd.com' && document.title == "返现明细") {
    getSetting('job10_frequency', getRebate)
  }

  // 剁手保护
  if ($("#InitCartUrl").size() > 0) {
    getSetting('hand_protection', handProtection)
  }

  // 自营筛选
  // if ($("#search").size() > 0) {
  //   $('#search .form').submit(function (evt) {
  //     evt.preventDefault();
  //   });
  //   $("#search input").attr("onkeydown", "javascript:if(event.keyCode==13) addSelfOperated('key');");
  //   $("#search button").attr("onclick", "addSelfOperated('key'); return false;");
  // }
  // if ($("#search-2014").size() > 0) {
  //   $('#search-2014 .form').submit(function (evt) {
  //     evt.preventDefault();
  //   });
  //   $("#search-2014 input").attr("onkeydown", "javascript:if(event.keyCode==13) addSelfOperated('key');");
  //   $("#search-2014 button").attr("onclick", "addSelfOperated('key'); return false;");
  // }
  

  // 自动跳转至商品页面
  if ($(".shop_intro .gobuy").length > 0) {
    getSetting('auto_gobuy', autoGobuy)
  };
  
  // 价格保护（1）
  if ($(".bd-product-list ").size() > 0 && $("#jb-product").text() == "价保申请") {
    getSetting('job1_frequency', priceProtect)
  };

  // 手机验证码
  if ($('.tip-box').size() > 0 && $(".tip-box").text().indexOf("账户存在风险") > -1) {
    chrome.runtime.sendMessage({
      text: "highlightTab",
      content: JSON.stringify({
        url: window.location.href,
        pinned: "true"
      })
    }, function(response) {
      console.log("Response: ", response);
    });  
  }
}

$( document ).ready(function() {
  console.log('京价保注入页面成功');
  setTimeout( function(){
    console.log('京价保开始执行任务');
    CheckDom()
  }, 2000)
});

var nodeList = document.querySelectorAll('script');
for (var i = 0; i < nodeList.length; ++i) {
  var node = nodeList[i];
  node.src = node.src.replace("http://", "https://")
}